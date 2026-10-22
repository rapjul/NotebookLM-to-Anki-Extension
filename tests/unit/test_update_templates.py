#!/usr/bin/env python3
"""test_update_templates.py

Unit test suite for the Anki card templates updater CLI script.
Tests delimiter extraction, fallback heuristic migration for external code (such as AJT Japanese),
idempotency, and backup creation.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict

# Import tested module from scripts directory
import sys

SCRIPTS_DIR = Path(__file__).resolve().parent.parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from update_card_templates import (  # noqa: E402
    CANONICAL_CSS_END,
    CANONICAL_CSS_START,
    CANONICAL_HTML_END,
    CANONICAL_HTML_START,
    create_backup,
    create_parser,
    execute_with_editor_retry,
    format_editor_conflict_message,
    parse_args,
    splice_css_stylesheet,
    splice_html_template,
    strip_css_markers,
    strip_html_markers,
)


class TestUpdateCardTemplates(unittest.TestCase):
    """Test suite for update_card_templates helper functions."""

    def test_strip_html_markers(self) -> None:
        """Verifies that outer HTML boundary comments are cleanly removed."""
        raw_html = f"{CANONICAL_HTML_START}\n<div class=\"main\">Content</div>\n{CANONICAL_HTML_END}"
        stripped = strip_html_markers(raw_html)
        self.assertEqual(stripped, "<div class=\"main\">Content</div>")

        # Also supports legacy format
        legacy_html = "<!-- NOTEBOOKLM_TEMPLATE_START -->\n<span>Card</span>\n<!-- NOTEBOOKLM_TEMPLATE_END -->"
        self.assertEqual(strip_html_markers(legacy_html), "<span>Card</span>")

    def test_strip_css_markers(self) -> None:
        """Verifies that outer CSS boundary comments are cleanly removed."""
        raw_css = f"{CANONICAL_CSS_START}\n.card {{ color: red; }}\n{CANONICAL_CSS_END}"
        stripped = strip_css_markers(raw_css)
        self.assertEqual(stripped, ".card { color: red; }")

        # Also supports legacy format
        legacy_css = "/* NOTEBOOKLM_STYLING_START */\n.card { font: sans; }\n/* NOTEBOOKLM_STYLING_END */"
        self.assertEqual(strip_css_markers(legacy_css), ".card { font: sans; }")

    def test_splice_html_with_existing_markers(self) -> None:
        """Verifies splicing when boundary markers are already present in live HTML."""
        live_html = (
            "<!-- Custom Header -->\n"
            f"{CANONICAL_HTML_START}\n"
            "<div class=\"old\">Old Content</div>\n"
            f"{CANONICAL_HTML_END}\n"
            "<script>/* AJT Japanese JS */</script>"
        )
        local_html = "<div class=\"new\">New Content</div>"

        merged, prefix, suffix = splice_html_template(live_html, local_html)

        self.assertIn("<!-- Custom Header -->", prefix)
        self.assertIn("<script>/* AJT Japanese JS */</script>", suffix)
        self.assertIn("<div class=\"new\">New Content</div>", merged)
        self.assertNotIn("<div class=\"old\">Old Content</div>", merged)
        self.assertTrue(merged.startswith("<!-- Custom Header -->"))
        self.assertTrue(merged.endswith("<script>/* AJT Japanese JS */</script>"))

    def test_splice_html_fallback_migration_heuristic(self) -> None:
        """Verifies unmigrated live template splits addon code from AJT Japanese script correctly."""
        live_unmigrated = (
            "<div class=\"main-wrapper mode-centered\">\n"
            "\t<div class=\"question\">What is X?</div>\n"
            "</div>\n"
            "<script>\n"
            "\t(function () {\n"
            "\t\tconsole.log('addon script');\n"
            "\t})();\n"
            "</script>\n\n\n\n"
            "<script>\n"
            "/* AJT Japanese JS 25.4.30.1 */\n"
            "(function () { console.log('ajt'); })();\n"
            "</script>"
        )
        local_html = (
            "<div class=\"main-wrapper mode-centered\">\n"
            "\t<div class=\"question\">Updated local template</div>\n"
            "</div>\n"
            "<script>\n"
            "\t(function () {\n"
            "\t\tconsole.log('updated addon script');\n"
            "\t})();\n"
            "</script>"
        )

        merged, prefix, suffix = splice_html_template(live_unmigrated, local_html)

        self.assertEqual(prefix, "")
        self.assertIn("/* AJT Japanese JS 25.4.30.1 */", suffix)
        self.assertIn(CANONICAL_HTML_START, merged)
        self.assertIn(CANONICAL_HTML_END, merged)
        self.assertIn("Updated local template", merged)
        self.assertIn("/* AJT Japanese JS 25.4.30.1 */", merged)
        self.assertNotIn("What is X?", merged)

    def test_splice_css_with_existing_markers(self) -> None:
        """Verifies splicing when boundary markers are already present in live CSS."""
        live_css = (
            "@charset \"UTF-8\";\n"
            "@import url(\"_ajt_japanese.css\");\n\n"
            f"{CANONICAL_CSS_START}\n"
            ".old-card { margin: 0; }\n"
            f"{CANONICAL_CSS_END}"
        )
        local_css = ".new-card { margin: 10px; }"

        merged, prefix, suffix = splice_css_stylesheet(live_css, local_css)

        self.assertIn("@import url(\"_ajt_japanese.css\");", prefix)
        self.assertIn(".new-card { margin: 10px; }", merged)
        self.assertNotIn(".old-card { margin: 0; }", merged)
        self.assertTrue(merged.startswith("@charset \"UTF-8\";"))

    def test_splice_css_fallback_migration_heuristic(self) -> None:
        """Verifies unmigrated live CSS preserves leading @charset and @import rules."""
        live_unmigrated = (
            "@charset \"UTF-8\";\n"
            "@import url(\"_ajt_japanese_25.4.30.1.css\");\n\n\n"
            "/* NotebookLM to Anki - Card Styling (v10.0 Adaptive Multi-Format) */\n"
            ".card { font-family: sans-serif; }\n"
        )
        local_css = (
            "/* NotebookLM to Anki - Card Styling (v10.0 Adaptive Multi-Format) */\n"
            ".card { font-family: system-ui; }\n"
        )

        merged, prefix, suffix = splice_css_stylesheet(live_unmigrated, local_css)

        self.assertIn("@import url(\"_ajt_japanese_25.4.30.1.css\");", prefix)
        self.assertIn(CANONICAL_CSS_START, merged)
        self.assertIn(CANONICAL_CSS_END, merged)
        self.assertIn(".card { font-family: system-ui; }", merged)
        self.assertNotIn(".card { font-family: sans-serif; }", merged)

    def test_splicing_idempotency(self) -> None:
        """Verifies that splicing an already-spliced template produces identical output."""
        live_unmigrated = (
            "<div class=\"q\">Question</div>\n"
            "<script>\n(function () {})();\n</script>\n"
            "<script>/* AJT */</script>"
        )
        local_html = "<div class=\"q\">Updated Question</div>\n<script>\n(function () {})();\n</script>"

        merged_first, _, _ = splice_html_template(live_unmigrated, local_html)
        merged_second, _, _ = splice_html_template(merged_first, local_html)

        self.assertEqual(merged_first, merged_second)

    def test_create_backup(self) -> None:
        """Verifies backup directory creation, HTML/CSS dump, and metadata persistence."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            backup_root = Path(tmp_dir)
            templates: Dict[str, Any] = {
                "NotebookLM Quiz": {
                    "Front": "<div>Front Live</div>",
                    "Back": "<div>Back Live</div>",
                }
            }
            styling: Dict[str, Any] = {"css": ".live { color: blue; }"}

            saved_dir = create_backup(
                backup_dir=backup_root,
                model_name="NotebookLM Quiz",
                templates=templates,
                styling=styling,
            )

            self.assertTrue(saved_dir.is_dir())
            front_file = saved_dir / "NotebookLM_Quiz_front.html"
            back_file = saved_dir / "NotebookLM_Quiz_back.html"
            css_file = saved_dir / "styling.css"
            meta_file = saved_dir / "metadata.json"

            self.assertTrue(front_file.is_file())
            self.assertTrue(back_file.is_file())
            self.assertTrue(css_file.is_file())
            self.assertTrue(meta_file.is_file())

            self.assertEqual(front_file.read_text(encoding="utf-8"), "<div>Front Live</div>")
            self.assertEqual(back_file.read_text(encoding="utf-8"), "<div>Back Live</div>")
            self.assertEqual(css_file.read_text(encoding="utf-8"), ".live { color: blue; }")

            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            self.assertEqual(meta["model_name"], "NotebookLM Quiz")

    def test_parse_args_defaults_to_none_action(self) -> None:
        """Verifies that running without an action argument defaults to None."""
        args = parse_args([])
        self.assertIsNone(args.action)

    def test_parse_args_short_dry_run_flag(self) -> None:
        """Verifies that the -n short flag sets dry_run to True."""
        args = parse_args(["push", "-n"])
        self.assertEqual(args.action, "push")
        self.assertTrue(args.dry_run)

    def test_create_parser_help_text(self) -> None:
        """Verifies that the CLI parser help text documents all available actions."""
        parser = create_parser()
        help_text = parser.format_help()
        self.assertIn("push", help_text)
        self.assertIn("diff", help_text)
        self.assertIn("status", help_text)
        self.assertIn("pull", help_text)
        self.assertIn("-n, --dry-run", help_text)

    def test_format_editor_conflict_message(self) -> None:
        """Verifies that the editor conflict message advises closing all windows except the main window."""
        msg = format_editor_conflict_message()
        self.assertIn("Browse window", msg)
        self.assertIn("Add window", msg)
        self.assertIn("Card Types", msg)
        self.assertIn("Close all Anki windows except the single main window", msg)

    def test_execute_with_editor_retry_success(self) -> None:
        """Verifies that interactive retry prompts user and succeeds on second attempt."""
        attempts = 0

        def fake_operation() -> str:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise RuntimeError("AnkiConnect error: Close the affected editor before this API write, even if its content is saved.")
            return "success"

        user_inputs = [""]  # User presses Enter
        result = execute_with_editor_retry(
            action_name="push",
            operation_fn=fake_operation,
            interactive=True,
            input_fn=lambda prompt: user_inputs.pop(0),
        )
        self.assertEqual(result, "success")
        self.assertEqual(attempts, 2)

    def test_execute_with_editor_retry_user_cancelled(self) -> None:
        """Verifies that user entering 'q' aborts the retry loop with RuntimeError."""
        def fake_operation() -> str:
            raise RuntimeError("AnkiConnect error: Close the affected editor before this API write, even if its content is saved.")

        with self.assertRaises(RuntimeError):
            execute_with_editor_retry(
                action_name="push",
                operation_fn=fake_operation,
                interactive=True,
                input_fn=lambda prompt: "q",
            )

    def test_execute_with_editor_retry_non_interactive(self) -> None:
        """Verifies that non-interactive execution raises immediately without calling input_fn."""
        input_called = False

        def fake_input(prompt: str) -> str:
            nonlocal input_called
            input_called = True
            return ""

        def fake_operation() -> str:
            raise RuntimeError("AnkiConnect error: Close the affected editor before this API write, even if its content is saved.")

        with self.assertRaises(RuntimeError):
            execute_with_editor_retry(
                action_name="push",
                operation_fn=fake_operation,
                interactive=False,
                input_fn=fake_input,
            )
        self.assertFalse(input_called)

    def test_execute_with_editor_retry_other_error_not_caught(self) -> None:
        """Verifies that non-editor errors are raised immediately without retry."""
        def fake_operation() -> str:
            raise RuntimeError("AnkiConnect error: Model not found")

        with self.assertRaises(RuntimeError) as ctx:
            execute_with_editor_retry(
                action_name="push",
                operation_fn=fake_operation,
                interactive=True,
            )
        self.assertIn("Model not found", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
