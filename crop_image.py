from PIL import Image
import sys

def crop_transparent(image_path, output_path):
    try:
        img = Image.open(image_path)
        img = img.convert("RGBA")
        bbox = img.getbbox()
        if bbox:
            cropped_img = img.crop(bbox)
            cropped_img.save(output_path)
            print(f"Cropped image saved to {output_path}")
            print(f"New size: {cropped_img.size}")
        else:
            print("Image is fully transparent.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python crop_image.py <input_path> <output_path>")
    else:
        crop_transparent(sys.argv[1], sys.argv[2])
