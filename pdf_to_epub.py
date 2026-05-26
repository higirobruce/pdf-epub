#!/usr/bin/env python3
"""PDF to EPUB converter using PyMuPDF for extraction and ebooklib for EPUB creation."""

import argparse
import base64
import sys
import uuid
from io import BytesIO
from pathlib import Path

import fitz  # PyMuPDF
from ebooklib import epub
from PIL import Image


def extract_page_content(page: fitz.Page) -> tuple[str, list[dict]]:
    """Extract text blocks and images from a PDF page."""
    text_blocks = page.get_text("blocks")
    images = []

    for img_info in page.get_images(full=True):
        xref = img_info[0]
        base_image = page.parent.extract_image(xref)
        if not base_image:
            continue
        img_bytes = base_image["image"]
        img_ext = base_image["ext"]

        try:
            pil_img = Image.open(BytesIO(img_bytes))
            if pil_img.mode in ("RGBA", "P"):
                pil_img = pil_img.convert("RGB")
            out = BytesIO()
            pil_img.save(out, format="JPEG", quality=85)
            images.append({"data": out.getvalue(), "ext": "jpg"})
        except Exception:
            images.append({"data": img_bytes, "ext": img_ext})

    return text_blocks, images


def blocks_to_html(text_blocks: list) -> str:
    """Convert PyMuPDF text blocks to simple HTML."""
    paragraphs = []
    for block in text_blocks:
        if block[6] != 0:  # skip non-text blocks
            continue
        text = block[4].strip()
        if not text:
            continue
        # Heuristic: short all-caps lines are likely headings
        lines = text.split("\n")
        html_lines = []
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            if len(stripped) < 80 and stripped == stripped.upper() and stripped.replace(" ", "").isalpha():
                html_lines.append(f"<h2>{stripped}</h2>")
            else:
                html_lines.append(f"<p>{stripped}</p>")
        paragraphs.extend(html_lines)
    return "\n".join(paragraphs)


def convert(pdf_path: str, output_path: str | None = None, title: str | None = None, author: str | None = None) -> str:
    """Convert a PDF file to EPUB and return the output path."""
    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    if output_path is None:
        output_path = pdf_path.with_suffix(".epub")
    output_path = Path(output_path)

    doc = fitz.open(str(pdf_path))

    # Pull metadata from PDF if not provided
    meta = doc.metadata
    book_title = title or meta.get("title") or pdf_path.stem
    book_author = author or meta.get("author") or "Unknown"

    book = epub.EpubBook()
    book.set_identifier(str(uuid.uuid4()))
    book.set_title(book_title)
    book.set_language("en")
    book.add_author(book_author)

    chapters = []
    image_items = []
    global_image_counter = 0

    for page_num in range(len(doc)):
        page = doc[page_num]
        text_blocks, page_images = extract_page_content(page)

        html_body = blocks_to_html(text_blocks)

        # Embed images into chapter HTML
        img_tags = []
        for img in page_images:
            global_image_counter += 1
            img_name = f"image_{global_image_counter}.{img['ext']}"
            epub_img = epub.EpubImage()
            epub_img.file_name = f"images/{img_name}"
            epub_img.media_type = "image/jpeg"
            epub_img.content = img["data"]
            image_items.append(epub_img)
            img_tags.append(f'<img src="../images/{img_name}" alt="image {global_image_counter}" style="max-width:100%;"/>')

        img_html = "\n".join(img_tags)

        chapter_html = f"""<?xml version='1.0' encoding='utf-8'?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Page {page_num + 1}</title></head>
<body>
{html_body}
{img_html}
</body>
</html>"""

        chapter = epub.EpubHtml(
            title=f"Page {page_num + 1}",
            file_name=f"page_{page_num + 1:04d}.xhtml",
            lang="en",
        )
        chapter.content = chapter_html.encode("utf-8")
        book.add_item(chapter)
        chapters.append(chapter)

    for img_item in image_items:
        book.add_item(img_item)

    book.toc = [(epub.Section(book_title), chapters)]
    book.spine = ["nav"] + chapters
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())

    epub.write_epub(str(output_path), book)
    doc.close()

    return str(output_path)


def main():
    parser = argparse.ArgumentParser(description="Convert a PDF file to EPUB format.")
    parser.add_argument("pdf", help="Path to the input PDF file")
    parser.add_argument("-o", "--output", help="Path for the output EPUB file (default: same name as PDF)")
    parser.add_argument("--title", help="Override the book title")
    parser.add_argument("--author", help="Override the book author")
    args = parser.parse_args()

    try:
        out = convert(args.pdf, args.output, args.title, args.author)
        print(f"Converted: {out}")
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Conversion failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
