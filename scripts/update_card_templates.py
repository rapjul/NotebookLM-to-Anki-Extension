#!/usr/bin/env python3
"""update_card_templates.py

Synchronizes local card templates (Front, Back, and Styles) to the NotebookLM
Quiz card type in Anki via the AnkiConnect API. Safely preserves external,
non-addon code (such as AJT Japanese pitch accent/furigana scripts or custom
user CSS imports) using standardized boundary delimiter comments.
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import platform
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

# Standard boundary comments used for deterministic template splicing
HTML_START_PATTERN = re.compile(
    r"<!--\s*(?:--------------------\s*)?NotebookLM Template: Start(?:\s*--------------------)?\s*-->|"
    r"<!--\s*NOTEBOOKLM_TEMPLATE_START\s*-->",
    re.IGNORECASE,
)
HTML_END_PATTERN = re.compile(
    r"<!--\s*(?:--------------------\s*)?NotebookLM Template: End(?:\s*--------------------)?\s*-->|"
    r"<!--\s*NOTEBOOKLM_TEMPLATE_END\s*-->",
    re.IGNORECASE,
)

CSS_START_PATTERN = re.compile(
    r"/\*\s*(?:--------------------\s*)?NotebookLM Template: Start(?:\s*--------------------)?\s*\*/|"
    r"/\*\s*NOTEBOOKLM_STYLING_START\s*\*/",
    re.IGNORECASE,
)
CSS_END_PATTERN = re.compile(
    r"/\*\s*(?:--------------------\s*)?NotebookLM Template: End(?:\s*--------------------)?\s*\*/|"
    r"/\*\s*NOTEBOOKLM_STYLING_END\s*\*/",
    re.IGNORECASE,
)

CANONICAL_HTML_START = "<!-- -------------------- NotebookLM Template: Start -------------------- -->"
CANONICAL_HTML_END = "<!-- -------------------- NotebookLM Template: End -------------------- -->"
CANONICAL_CSS_START = "/* -------------------- NotebookLM Template: Start -------------------- */"
CANONICAL_CSS_END = "/* -------------------- NotebookLM Template: End -------------------- */"


def query_anki(
    action: str,
    params: Optional[Dict[str, Any]] = None,
    anki_url: str = "http://127.0.0.1:8765",
    timeout: float = 5.0,
) -> Any:
    """Dispatches a JSON-RPC request to the AnkiConnect API endpoint.

    Args:
        action: The AnkiConnect action name (e.g. 'modelTemplates').
        params: Optional dictionary containing action parameters.
        anki_url: HTTP endpoint of the AnkiConnect service.
        timeout: Socket connection and read timeout in seconds.

    Returns:
        The 'result' field of the AnkiConnect JSON response.

    Raises:
        ConnectionError: If AnkiConnect is unreachable.
        RuntimeError: If AnkiConnect returns an API-level error.
    """
    payload: Dict[str, Any] = {"action": action, "version": 6}
    if params is not None:
        payload["params"] = params

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        anki_url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            res_json = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError) as exc:
        raise ConnectionError(
            f"Unable to connect to AnkiConnect at {anki_url}. Is Anki running?"
        ) from exc

    if res_json.get("error"):
        raise RuntimeError(f"AnkiConnect error: {res_json['error']}")

    return res_json.get("result")


def check_anki_online(
    anki_url: str = "http://127.0.0.1:8765",
    timeout: float = 1.5,
) -> bool:
    """Verifies whether the AnkiConnect HTTP service is reachable and responsive.

    Args:
        anki_url: HTTP endpoint of AnkiConnect.
        timeout: Socket timeout in seconds.

    Returns:
        True if AnkiConnect responded with version information; False otherwise.
    """
    try:
        ver = query_anki("version", anki_url=anki_url, timeout=timeout)
        return isinstance(ver, int)
    except Exception:
        return False


def launch_anki_app(
    anki_url: str = "http://127.0.0.1:8765",
    max_wait_seconds: int = 20,
) -> bool:
    """Attempts to launch the Anki desktop application and waits for AnkiConnect to respond.

    Args:
        anki_url: HTTP endpoint of AnkiConnect to poll.
        max_wait_seconds: Maximum time in seconds to wait for AnkiConnect to become ready.

    Returns:
        True if AnkiConnect becomes available within the timeout; False otherwise.
    """
    current_os = platform.system().lower()
    print("🚀 Launching Anki desktop application...")

    try:
        if current_os == "darwin":
            subprocess.Popen(["open", "-a", "Anki"])
        elif current_os == "windows":
            subprocess.Popen(["start", "anki"], shell=True)
        else:
            subprocess.Popen(["anki"])
    except Exception as exc:
        print(f"❌ Failed to launch Anki automatically: {exc}", file=sys.stderr)
        return False

    print("⏳ Waiting for AnkiConnect to initialize...", end="", flush=True)
    start_time = time.time()
    while time.time() - start_time < max_wait_seconds:
        time.sleep(1.0)
        print(".", end="", flush=True)
        if check_anki_online(anki_url, timeout=1.0):
            print(" Connected!")
            return True

    print("\n❌ Timed out waiting for AnkiConnect to respond.", file=sys.stderr)
    return False


def ensure_anki_connection(
    anki_url: str = "http://127.0.0.1:8765",
    auto_launch: bool = False,
    no_prompt: bool = False,
) -> bool:
    """Ensures that AnkiConnect is accessible, prompting to launch Anki if running interactively.

    Args:
        anki_url: HTTP endpoint of AnkiConnect.
        auto_launch: If True, automatically launches Anki without user confirmation.
        no_prompt: If True, skips interactive user prompts.

    Returns:
        True if connection is confirmed; False if connection could not be established.
    """
    if check_anki_online(anki_url):
        return True

    print(f"⚠️  AnkiConnect is unreachable at {anki_url}.")
    if auto_launch:
        return launch_anki_app(anki_url)

    if sys.stdin.isatty() and not no_prompt:
        try:
            choice = input(
                "Anki does not appear to be running. Would you like to launch Anki now? [y/N]: "
            ).strip().lower()
            if choice in ("y", "yes"):
                return launch_anki_app(anki_url)
        except (KeyboardInterrupt, EOFError):
            print()
            return False

    return False


def read_local_templates(
    repo_root: Path,
) -> Tuple[str, str, str]:
    """Reads the Front, Back, and Styling templates from the local repository directory.

    Args:
        repo_root: Base path of the repository workspace.

    Returns:
        A tuple of (front_html, back_html, styling_css).

    Raises:
        FileNotFoundError: If any of the required template files are missing.
    """
    tmpl_dir = repo_root / "src" / "anki_templates"
    front_path = tmpl_dir / "front.html"
    back_path = tmpl_dir / "back.html"
    css_path = tmpl_dir / "styling.css"

    if not front_path.is_file():
        raise FileNotFoundError(f"Missing Front template at {front_path}")
    if not back_path.is_file():
        raise FileNotFoundError(f"Missing Back template at {back_path}")
    if not css_path.is_file():
        raise FileNotFoundError(f"Missing Styling template at {css_path}")

    front_html = front_path.read_text(encoding="utf-8")
    back_html = back_path.read_text(encoding="utf-8")
    styling_css = css_path.read_text(encoding="utf-8")

    return front_html, back_html, styling_css


def strip_html_markers(content: str) -> str:
    """Strips outer NotebookLM boundary comments from an HTML template string.

    Args:
        content: HTML template string.

    Returns:
        Clean content without outer boundary comments.
    """
    start_match = HTML_START_PATTERN.search(content)
    end_match = HTML_END_PATTERN.search(content)

    start_idx = start_match.end() if start_match else 0
    end_idx = end_match.start() if end_match else len(content)

    return content[start_idx:end_idx].strip("\r\n")


def strip_css_markers(content: str) -> str:
    """Strips outer NotebookLM boundary comments from a CSS stylesheet string.

    Args:
        content: CSS stylesheet string.

    Returns:
        Clean content without outer boundary comments.
    """
    start_match = CSS_START_PATTERN.search(content)
    end_match = CSS_END_PATTERN.search(content)

    start_idx = start_match.end() if start_match else 0
    end_idx = end_match.start() if end_match else len(content)

    return content[start_idx:end_idx].strip("\r\n")


def splice_html_template(
    live_content: str,
    local_content: str,
) -> Tuple[str, str, str]:
    """Splices local HTML into live HTML, preserving any non-addon prefix or suffix code.

    Args:
        live_content: Current live HTML template content from Anki.
        local_content: Updated local HTML template content from repository.

    Returns:
        A tuple of (merged_content, preserved_prefix, preserved_suffix).
    """
    start_match = HTML_START_PATTERN.search(live_content)
    end_match = HTML_END_PATTERN.search(live_content)

    # 1. Delimiters already present in live template
    if start_match and end_match and start_match.start() < end_match.end():
        prefix = live_content[: start_match.start()]
        suffix = live_content[end_match.end() :]
    else:
        # 2. Fallback heuristic for unmigrated live templates
        # Addon HTML ends at the closing </script> tag of the main controller.
        # Any subsequent scripts (like AJT Japanese) belong to the suffix.
        prefix = ""
        closing_script_pattern = re.compile(r"\)\s*;\s*\n?\s*</script>", re.IGNORECASE)
        matches = list(closing_script_pattern.finditer(live_content))
        if matches:
            # The addon script is the first main script block
            first_match = matches[0]
            cutoff = first_match.end()
            suffix = live_content[cutoff:]
        else:
            suffix = ""

    clean_local = strip_html_markers(local_content)

    # Assemble canonical output with delimiters
    assembled_parts: List[str] = []
    if prefix:
        assembled_parts.append(prefix.rstrip("\r\n"))
    assembled_parts.append(CANONICAL_HTML_START)
    assembled_parts.append(clean_local)
    assembled_parts.append(CANONICAL_HTML_END)
    if suffix:
        # Preserve original spacing if suffix begins with whitespace
        assembled_parts.append(suffix.lstrip("\r\n"))

    merged = "\n".join(assembled_parts)
    return merged, prefix, suffix


def splice_css_stylesheet(
    live_content: str,
    local_content: str,
) -> Tuple[str, str, str]:
    """Splices local CSS into live CSS, preserving any non-addon prefix or suffix rules.

    Args:
        live_content: Current live CSS stylesheet content from Anki.
        local_content: Updated local CSS stylesheet content from repository.

    Returns:
        A tuple of (merged_content, preserved_prefix, preserved_suffix).
    """
    start_match = CSS_START_PATTERN.search(live_content)
    end_match = CSS_END_PATTERN.search(live_content)

    # 1. Delimiters already present in live template
    if start_match and end_match and start_match.start() < end_match.end():
        prefix = live_content[: start_match.start()]
        suffix = live_content[end_match.end() :]
    else:
        # 2. Fallback heuristic for unmigrated live stylesheets
        # Non-addon code appears as leading @charset or @import statements prior to
        # the NotebookLM styling header comment.
        addon_header_pattern = re.compile(
            r"/\*\s*NotebookLM to Anki\s*-\s*Card Styling",
            re.IGNORECASE,
        )
        header_match = addon_header_pattern.search(live_content)
        if header_match:
            prefix = live_content[: header_match.start()]
            suffix = ""
        else:
            prefix = ""
            suffix = ""

    clean_local = strip_css_markers(local_content)

    # Assemble canonical output with delimiters
    assembled_parts: List[str] = []
    if prefix:
        assembled_parts.append(prefix.rstrip("\r\n"))
        assembled_parts.append("")  # blank separator line
    assembled_parts.append(CANONICAL_CSS_START)
    assembled_parts.append(clean_local)
    assembled_parts.append(CANONICAL_CSS_END)
    if suffix:
        assembled_parts.append("")
        assembled_parts.append(suffix.lstrip("\r\n"))

    merged = "\n".join(assembled_parts)
    return merged, prefix, suffix


def create_backup(
    backup_dir: Path,
    model_name: str,
    templates: Dict[str, Any],
    styling: Dict[str, Any],
) -> Path:
    """Saves a timestamped backup of the current live Anki templates and stylesheet.

    Args:
        backup_dir: Root directory for storing backups.
        model_name: Name of the Anki model being backed up.
        templates: Raw dictionary returned from modelTemplates API.
        styling: Raw dictionary returned from modelStyling API.

    Returns:
        Path to the timestamped backup directory created.
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe_model = re.sub(r"[^\w\-]", "_", model_name)
    target_dir = backup_dir / f"{safe_model}_{timestamp}"
    target_dir.mkdir(parents=True, exist_ok=True)

    # Write individual template files
    for card_name, card_data in templates.items():
        safe_card = re.sub(r"[^\w\-]", "_", card_name)
        if isinstance(card_data, dict):
            if "Front" in card_data:
                (target_dir / f"{safe_card}_front.html").write_text(
                    card_data["Front"], encoding="utf-8"
                )
            if "Back" in card_data:
                (target_dir / f"{safe_card}_back.html").write_text(
                    card_data["Back"], encoding="utf-8"
                )

    if isinstance(styling, dict) and "css" in styling:
        (target_dir / "styling.css").write_text(styling["css"], encoding="utf-8")

    # Write metadata JSON
    meta = {
        "model_name": model_name,
        "timestamp": timestamp,
        "templates": templates,
        "styling": styling,
    }
    (target_dir / "metadata.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    return target_dir


def print_colored_diff(label: str, old_text: str, new_text: str) -> bool:
    """Computes and prints a unified diff between two text strings with terminal coloring.

    Args:
        label: Descriptive label for the comparison.
        old_text: Original text string.
        new_text: Modified text string.

    Returns:
        True if differences were found; False if the texts are identical.
    """
    diff_lines = list(
        difflib.unified_diff(
            old_text.splitlines(keepends=True),
            new_text.splitlines(keepends=True),
            fromfile=f"Live Anki ({label})",
            tofile=f"Proposed Update ({label})",
            n=3,
        )
    )

    if not diff_lines:
        print(f"  ✅ {label}: In sync (no changes).")
        return False

    print(f"\n--- Diff: {label} ---")
    use_color = sys.stdout.isatty() and os.name != "nt"
    green = "\033[32m" if use_color else ""
    red = "\033[31m" if use_color else ""
    cyan = "\033[36m" if use_color else ""
    reset = "\033[0m" if use_color else ""

    for line in diff_lines:
        if line.startswith("+++") or line.startswith("---"):
            print(f"{cyan}{line.rstrip()}{reset}")
        elif line.startswith("+"):
            print(f"{green}{line.rstrip()}{reset}")
        elif line.startswith("-"):
            print(f"{red}{line.rstrip()}{reset}")
        elif line.startswith("@@"):
            print(f"{cyan}{line.rstrip()}{reset}")
        else:
            print(line.rstrip())

    return True


def action_status(
    anki_url: str,
    model_name: str,
    card_name: str,
    repo_root: Path,
) -> None:
    """Displays connection status, model statistics, and detected external code blocks.

    Args:
        anki_url: HTTP endpoint of AnkiConnect.
        model_name: Target Anki model name.
        card_name: Target card template name within the model.
        repo_root: Base path of repository.
    """
    print(f"🔍 Checking AnkiConnect at {anki_url}...")
    models = query_anki("modelNames", anki_url=anki_url)
    if model_name not in models:
        print(f"❌ Model '{model_name}' was not found in Anki.")
        return

    cards = query_anki("findCards", {"query": f'note:"{model_name}"'}, anki_url=anki_url)
    print(f"✅ Model '{model_name}' found. Total cards: {len(cards)}")

    templates = query_anki("modelTemplates", {"modelName": model_name}, anki_url=anki_url)
    styling = query_anki("modelStyling", {"modelName": model_name}, anki_url=anki_url)

    card_tmpl = templates.get(card_name, {})
    live_front = card_tmpl.get("Front", "")
    live_back = card_tmpl.get("Back", "")
    live_css = styling.get("css", "")

    front_has_markers = bool(HTML_START_PATTERN.search(live_front))
    back_has_markers = bool(HTML_START_PATTERN.search(live_back))
    css_has_markers = bool(CSS_START_PATTERN.search(live_css))

    print("\n📋 Delimiter Status:")
    print(f"  • Front Template: {'✅ Present' if front_has_markers else '⚠️ Missing (Will migrate on push)'}")
    print(f"  • Back Template:  {'✅ Present' if back_has_markers else '⚠️ Missing (Will migrate on push)'}")
    print(f"  • Stylesheet:     {'✅ Present' if css_has_markers else '⚠️ Missing (Will migrate on push)'}")

    # Inspect external non-addon code
    local_front, local_back, local_css = read_local_templates(repo_root)
    _, f_pref, f_suff = splice_html_template(live_front, local_front)
    _, b_pref, b_suff = splice_html_template(live_back, local_back)
    _, c_pref, c_suff = splice_css_stylesheet(live_css, local_css)

    print("\n🛡️ Preserved External Code:")
    if f_suff.strip():
        first_line = f_suff.strip().splitlines()[0][:60]
        print(f"  • Front Suffix detected: {len(f_suff)} chars ({first_line}...)")
    else:
        print("  • Front Suffix: None")

    if b_suff.strip():
        first_line = b_suff.strip().splitlines()[0][:60]
        print(f"  • Back Suffix detected: {len(b_suff)} chars ({first_line}...)")
    else:
        print("  • Back Suffix: None")

    if c_pref.strip():
        first_line = c_pref.strip().splitlines()[0][:60]
        print(f"  • CSS Prefix detected: {len(c_pref)} chars ({first_line}...)")
    else:
        print("  • CSS Prefix: None")


def action_diff(
    anki_url: str,
    model_name: str,
    card_name: str,
    repo_root: Path,
) -> bool:
    """Shows a unified diff between current Anki templates and proposed updates.

    Args:
        anki_url: HTTP endpoint of AnkiConnect.
        model_name: Target Anki model name.
        card_name: Target card template name within the model.
        repo_root: Base path of repository.

    Returns:
        True if differences exist; False if already in sync.
    """
    templates = query_anki("modelTemplates", {"modelName": model_name}, anki_url=anki_url)
    styling = query_anki("modelStyling", {"modelName": model_name}, anki_url=anki_url)

    card_tmpl = templates.get(card_name, {})
    live_front = card_tmpl.get("Front", "")
    live_back = card_tmpl.get("Back", "")
    live_css = styling.get("css", "")

    local_front, local_back, local_css = read_local_templates(repo_root)

    spliced_front, _, _ = splice_html_template(live_front, local_front)
    spliced_back, _, _ = splice_html_template(live_back, local_back)
    spliced_css, _, _ = splice_css_stylesheet(live_css, local_css)

    diff1 = print_colored_diff(f"{card_name} Front", live_front, spliced_front)
    diff2 = print_colored_diff(f"{card_name} Back", live_back, spliced_back)
    diff3 = print_colored_diff("Styling CSS", live_css, spliced_css)

    return diff1 or diff2 or diff3


def format_editor_conflict_message() -> str:
    """Formats a detailed, actionable message explaining how to resolve Anki's editor conflict.

    Returns:
        Formatted multi-line advisory string.
    """
    return (
        "❌ Cannot update templates: Anki has an active editor window open.\n\n"
        "⚠️  Anki blocks template updates whenever any secondary window with an editor is open.\n"
        "👉 Please close all secondary windows (leave only the main Anki window open):\n"
        "   • Browse window (\"Browse\" card search)\n"
        "   • Add window (\"Add\" new notes)\n"
        "   • Edit Current window (card editor)\n"
        "   • Cards... / Card Types dialog (template editor)\n\n"
        "💡 Rule of thumb: Close all Anki windows except the single main window (Decks or Study screen)."
    )


def execute_with_editor_retry(
    action_name: str,
    operation_fn: Callable[[], Any],
    interactive: bool = True,
    input_fn: Callable[[str], str] = input,
) -> Any:
    """Executes an AnkiConnect operation, retrying interactively if an editor conflict occurs.

    Args:
        action_name: Name of the action being attempted (e.g. 'push').
        operation_fn: Callable executing the AnkiConnect API calls.
        interactive: If True and running in a TTY, prompts the user to retry after closing windows.
        input_fn: Input function for prompting user (defaults to built-in input).

    Returns:
        The result of operation_fn().

    Raises:
        RuntimeError: If operation_fn fails for reasons other than editorConflict,
            or if the user cancels or the session is non-interactive.
    """
    while True:
        try:
            return operation_fn()
        except RuntimeError as exc:
            err_msg = str(exc)
            if "Close the affected editor before this API write" not in err_msg:
                raise

            print(f"\n{format_editor_conflict_message()}", file=sys.stderr)

            if not interactive:
                raise

            try:
                choice = input_fn("\nPress Enter once closed to retry (or 'q' to cancel): ").strip().lower()
                if choice in ("q", "quit"):
                    print("🛑 Operation cancelled by user.", file=sys.stderr)
                    raise
                print("🔄 Retrying update in Anki...")
            except (KeyboardInterrupt, EOFError):
                print("\n🛑 Operation cancelled.", file=sys.stderr)
                raise


def action_push(
    anki_url: str,
    model_name: str,
    card_name: str,
    repo_root: Path,
    backup_dir: Path,
    skip_backup: bool = False,
    dry_run: bool = False,
    interactive: bool = True,
) -> None:
    """Synchronizes repository templates to Anki with automated backup and boundary preservation.

    Args:
        anki_url: HTTP endpoint of AnkiConnect.
        model_name: Target Anki model name.
        card_name: Target card template name within the model.
        repo_root: Base path of repository.
        backup_dir: Destination folder for backups.
        skip_backup: If True, skips backup creation.
        dry_run: If True, previews changes without executing updates in Anki.
        interactive: If True, enables interactive retry when editor conflict occurs.
    """
    templates = query_anki("modelTemplates", {"modelName": model_name}, anki_url=anki_url)
    styling = query_anki("modelStyling", {"modelName": model_name}, anki_url=anki_url)

    if card_name not in templates:
        raise KeyError(
            f"Card template '{card_name}' not found in model '{model_name}'. "
            f"Available templates: {list(templates.keys())}"
        )

    card_tmpl = templates[card_name]
    live_front = card_tmpl.get("Front", "")
    live_back = card_tmpl.get("Back", "")
    live_css = styling.get("css", "")

    local_front, local_back, local_css = read_local_templates(repo_root)

    spliced_front, f_pref, f_suff = splice_html_template(live_front, local_front)
    spliced_back, b_pref, b_suff = splice_html_template(live_back, local_back)
    spliced_css, c_pref, c_suff = splice_css_stylesheet(live_css, local_css)

    has_changes = (
        spliced_front != live_front
        or spliced_back != live_back
        or spliced_css != live_css
    )

    if not has_changes:
        print("✅ Anki templates and styling are already up-to-date. No changes necessary.")
        return

    if dry_run:
        print("🔍 Dry-run enabled. Inspecting proposed updates:")
        action_diff(anki_url, model_name, card_name, repo_root)
        print("\n✨ Dry-run completed. No updates were sent to Anki.")
        return

    # Create backup prior to applying changes
    if not skip_backup:
        saved_path = create_backup(backup_dir, model_name, templates, styling)
        print(f"📦 Created live backup at: {saved_path}")

    # Dispatch updates to AnkiConnect with retry handler
    def dispatch_update() -> None:
        print(f"🚀 Updating card templates for '{model_name}'...")
        query_anki(
            "updateModelTemplates",
            {
                "model": {
                    "name": model_name,
                    "templates": {
                        card_name: {
                            "Front": spliced_front,
                            "Back": spliced_back,
                        }
                    },
                }
            },
            anki_url=anki_url,
        )

        print("🚀 Updating stylesheet...")
        query_anki(
            "updateModelStyling",
            {
                "model": {
                    "name": model_name,
                    "css": spliced_css,
                }
            },
            anki_url=anki_url,
        )

    execute_with_editor_retry(
        action_name="push",
        operation_fn=dispatch_update,
        interactive=interactive,
    )

    print("🎉 Successfully updated NotebookLM card templates and styles in Anki!")


def action_pull(
    anki_url: str,
    model_name: str,
    card_name: str,
    repo_root: Path,
) -> None:
    """Pulls the addon portion of the card templates from Anki back into the repository.

    Args:
        anki_url: HTTP endpoint of AnkiConnect.
        model_name: Target Anki model name.
        card_name: Target card template name within the model.
        repo_root: Base path of repository.
    """
    templates = query_anki("modelTemplates", {"modelName": model_name}, anki_url=anki_url)
    styling = query_anki("modelStyling", {"modelName": model_name}, anki_url=anki_url)

    card_tmpl = templates.get(card_name, {})
    live_front = card_tmpl.get("Front", "")
    live_back = card_tmpl.get("Back", "")
    live_css = styling.get("css", "")

    clean_front = strip_html_markers(live_front)
    clean_back = strip_html_markers(live_back)
    clean_css = strip_css_markers(live_css)

    tmpl_dir = repo_root / "src" / "anki_templates"
    front_path = tmpl_dir / "front.html"
    back_path = tmpl_dir / "back.html"
    css_path = tmpl_dir / "styling.css"

    front_path.write_text(
        f"{CANONICAL_HTML_START}\n{clean_front}\n{CANONICAL_HTML_END}\n",
        encoding="utf-8",
    )
    back_path.write_text(
        f"{CANONICAL_HTML_START}\n{clean_back}\n{CANONICAL_HTML_END}\n",
        encoding="utf-8",
    )
    css_path.write_text(
        f"{CANONICAL_CSS_START}\n{clean_css}\n{CANONICAL_CSS_END}\n",
        encoding="utf-8",
    )

    print("📥 Successfully pulled and synchronized templates from Anki to repository.")


def create_parser() -> argparse.ArgumentParser:
    """Creates the command-line argument parser for the template updater CLI.

    Returns:
        Configured ArgumentParser instance.
    """
    parser = argparse.ArgumentParser(
        description="Synchronize NotebookLM card templates to Anki with external code preservation.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )

    parser.add_argument(
        "action",
        nargs="?",
        default=None,
        choices=["push", "diff", "status", "pull"],
        help="Action to perform: 'push' updates Anki, 'diff' shows unified diff, 'status' inspects Anki, 'pull' updates local repo files.",
    )

    parser.add_argument(
        "--model-name",
        type=str,
        default="NotebookLM Quiz",
        help="Target model name in Anki collection.",
    )

    parser.add_argument(
        "--card-name",
        type=str,
        default="NotebookLM Quiz",
        help="Target card template name within the model.",
    )

    parser.add_argument(
        "--anki-url",
        type=str,
        default="http://127.0.0.1:8765",
        help="AnkiConnect HTTP endpoint.",
    )

    parser.add_argument(
        "--backup-dir",
        type=Path,
        default=Path("./backups/templates"),
        help="Directory to store timestamped backups before updating.",
    )

    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Skip automatic backup generation prior to updating.",
    )

    parser.add_argument(
        "-n",
        "--dry-run",
        action="store_true",
        help="Preview changes and diff without modifying Anki collection.",
    )

    parser.add_argument(
        "--auto-launch",
        action="store_true",
        help="Automatically launch Anki desktop if unreachable without prompting.",
    )

    parser.add_argument(
        "--no-prompt",
        action="store_true",
        help="Disable interactive confirmation prompts.",
    )

    return parser


def parse_args(args: Optional[List[str]] = None) -> argparse.Namespace:
    """Configures command-line argument parser and parses options.

    Args:
        args: Optional list of argument strings (defaults to sys.argv[1:]).

    Returns:
        Parsed arguments namespace.
    """
    parser = create_parser()
    return parser.parse_args(args)


def main() -> int:
    """Main program entry point.

    Returns:
        Exit code (0 for success, non-zero for failure).
    """
    parser = create_parser()
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parent.parent

    # If no action was provided, print help text and exit cleanly
    if args.action is None:
        parser.print_help()
        return 0

    # Check connection
    if not ensure_anki_connection(
        anki_url=args.anki_url,
        auto_launch=args.auto_launch,
        no_prompt=args.no_prompt,
    ):
        print("❌ Cannot proceed without active AnkiConnect connection.", file=sys.stderr)
        return 1

    is_interactive = sys.stdin.isatty() and not args.no_prompt

    try:
        if args.action == "status":
            action_status(
                anki_url=args.anki_url,
                model_name=args.model_name,
                card_name=args.card_name,
                repo_root=repo_root,
            )
        elif args.action == "diff":
            action_diff(
                anki_url=args.anki_url,
                model_name=args.model_name,
                card_name=args.card_name,
                repo_root=repo_root,
            )
        elif args.action == "push":
            action_push(
                anki_url=args.anki_url,
                model_name=args.model_name,
                card_name=args.card_name,
                repo_root=repo_root,
                backup_dir=args.backup_dir,
                skip_backup=args.no_backup,
                dry_run=args.dry_run,
                interactive=is_interactive,
            )
        elif args.action == "pull":
            action_pull(
                anki_url=args.anki_url,
                model_name=args.model_name,
                card_name=args.card_name,
                repo_root=repo_root,
            )
        return 0
    except Exception as exc:
        err_msg = str(exc)
        if "Close the affected editor before this API write" not in err_msg:
            print(f"❌ Error executing '{args.action}': {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
