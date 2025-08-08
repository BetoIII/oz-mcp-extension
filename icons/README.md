# Icons Directory

This directory should contain the following PNG icon files for the Chrome extension:

- `icon16.png` - 16x16 pixels (toolbar icon)
- `icon32.png` - 32x32 pixels (Windows)
- `icon48.png` - 48x48 pixels (extension management page)
- `icon128.png` - 128x128 pixels (Chrome Web Store)

## Icon Requirements

- Format: PNG
- Transparent background recommended
- Square aspect ratio
- High contrast for visibility
- Consistent design across all sizes

## Creating Icons

You can create these icons using:
- Design tools like Figma, Sketch, or Adobe Illustrator
- Online icon generators
- Convert from SVG using tools like ImageMagick

Example command to create placeholder icons (requires ImageMagick):
```bash
# Create colored squares as placeholders
convert -size 16x16 xc:#667eea icons/icon16.png
convert -size 32x32 xc:#667eea icons/icon32.png
convert -size 48x48 xc:#667eea icons/icon48.png
convert -size 128x128 xc:#667eea icons/icon128.png
```