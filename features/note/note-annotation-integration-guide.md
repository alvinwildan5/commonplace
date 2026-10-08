# AWS Commonplace — Image Annotation Add-on

The current note editor already stores the complete editor HTML in `body_html`, so the drawing layer can be embedded as inline SVG without adding a Supabase column. The existing image picker can stay in place; the add-on overrides the image insertion function so every newly inserted image is annotation-ready.

## Installation

1. Copy `note-annotation-addon.js` to `features/note/note-annotation-addon.js`.
2. Copy `note-annotation.css` to `features/note/note-annotation.css`.
3. Add the stylesheet inside `<head>` after `note.css`.
4. Add the script immediately after the existing `/features/note/note.js` script.

## User flow

Insert image → choose its normal layout → the image becomes selected → click the marker icon → draw.

Tools: Pen, Line, Arrow, Box, Circle, Erase, Undo, Clear, Color, Size.

When the Pen detects a reasonably circular stroke, it shows **Circle detected → Perfect circle / Keep freehand**. The hand-drawn stroke is not replaced unless **Perfect circle** is clicked.

The same optional correction exists for straight lines and ellipses.

## Storage

Annotations are stored as SVG elements inside the same image wrapper inside `body_html`. Existing save/load/edit code therefore continues to work without a database migration.

## Compatibility

Existing plain images in older notes do not need to be converted in advance. Clicking an old image in the editor wraps it lazily in an annotation container, after which it can be marked and saved normally.
