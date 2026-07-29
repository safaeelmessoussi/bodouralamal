#!/usr/bin/env python3
"""
Resolve a stylesheet to its literal computed declarations.

Every `var()` is substituted recursively until only literal values remain, so
two stylesheets that *look* different but render identically produce byte-equal
output. This is what makes "no visual regression" a check rather than a claim:
the token refactor is correct exactly when this output does not change.

Media context is part of each key, because the same selector legitimately
declares different values at different widths.
"""
import re
import sys


def strip_comments(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def root_vars(css: str) -> dict[str, str]:
    """Custom properties declared on :root, in source order (later wins)."""
    values: dict[str, str] = {}
    for block in re.finditer(r":root\s*\{(.*?)\}", css, re.S):
        for name, value in re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", block.group(1)):
            values[name] = value.strip()
    return values


def resolve(value: str, variables: dict[str, str], depth: int = 0) -> str:
    """Substitute var() references, honouring fallbacks."""
    if depth > 25:
        return value
    def one(match: re.Match[str]) -> str:
        inner = match.group(1)
        parts = inner.split(",", 1)
        name = parts[0].strip()
        fallback = parts[1].strip() if len(parts) > 1 else ""
        if name in variables:
            return resolve(variables[name], variables, depth + 1)
        return resolve(fallback, variables, depth + 1) if fallback else match.group(0)
    # innermost-first so nested var() resolves correctly
    previous = None
    while previous != value:
        previous = value
        value = re.sub(r"var\(\s*(--[^()]*(?:\([^()]*\)[^()]*)*)\)", one, value)
    return normalise(re.sub(r"\s+", " ", value).strip())


def normalise(value: str) -> str:
    """Canonicalise equivalent literals so the diff shows only real changes.

    `#fff` and `#ffffff` are the same colour; a textual diff would report the
    swap as a regression and bury a genuine one."""
    def expand(match: re.Match[str]) -> str:
        digits = match.group(1)
        if len(digits) in (3, 4):
            digits = "".join(ch * 2 for ch in digits)
        return "#" + digits.lower()
    return re.sub(r"#([0-9a-fA-F]{3,8})\b", expand, value)


def declarations(css: str) -> dict[str, str]:
    """(media context ‖ selector ‖ property) -> resolved value."""
    variables = root_vars(css)
    out: dict[str, str] = {}
    media_stack: list[str] = []
    index = 0
    while index < len(css):
        at = css.find("{", index)
        if at == -1:
            break
        head = css[index:at].strip()
        # close any blocks that ended before this one
        head_clean = head.lstrip("}").strip()
        closed = head.count("}")
        for _ in range(min(closed, len(media_stack))):
            media_stack.pop()
        if head_clean.startswith("@media"):
            media_stack.append(re.sub(r"\s+", " ", head_clean))
            index = at + 1
            continue
        if head_clean.startswith("@"):
            depth, cursor = 1, at + 1
            while cursor < len(css) and depth:
                depth += (css[cursor] == "{") - (css[cursor] == "}")
                cursor += 1
            index = cursor
            continue
        end = css.find("}", at)
        body = css[at + 1:end]
        selector = re.sub(r"\s+", " ", head_clean)
        for name, value in re.findall(r"([\w-]+)\s*:\s*([^;]+)", body):
            if name.startswith("--"):
                continue  # definitions, not rendered declarations
            key = f"{' & '.join(media_stack)} ‖ {selector} ‖ {name}"
            out[key] = resolve(value.strip(), variables)
        index = end + 1
    return out


def assemble(entry: str) -> str:
    """Inline `@import` in order, which is what the bundler does.

    Import order IS the cascade here — every rule has single-class specificity,
    so the last file to declare a property wins. Resolving the graph rather than
    reading one file is what lets the guards keep checking the stylesheet as it
    actually renders, now that it lives in twenty files.
    """
    import os
    seen: set[str] = set()

    def walk(path: str) -> str:
        real = os.path.realpath(path)
        if real in seen:
            return ""
        seen.add(real)
        raw = open(real, encoding="utf-8").read()
        out: list[str] = []
        for line in raw.split("\n"):
            match = re.match(r"\s*@import\s+['\"](.+?)['\"]\s*;", line)
            if match:
                out.append(walk(os.path.join(os.path.dirname(real), match.group(1))))
            else:
                out.append(line)
        return "\n".join(out)

    return walk(entry)


if __name__ == "__main__":
    text = strip_comments(assemble(sys.argv[1]))
    for key, value in sorted(declarations(text).items()):
        print(f"{key} = {value}")
