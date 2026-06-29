#!/usr/bin/env python3

import re
import os
import requests
import argparse

def download_woff2_from_css(css_file, subset, output_dir="fonts"):
    font_face_pattern = re.compile(
        r"/\*\s*(.*?)\s*\*/.*?"
        r"font-family: '(.*?)';.*?"
        r"font-style: (.*?);.*?"
        r"font-weight: (.*?);.*?"
        r"src: url\((https://fonts\.gstatic\.com/.*?\.woff2)\)" , re.DOTALL
    )

    # User-Agent is required to get css subsets comments
    response = requests.get(
        css_file, 
        headers={
            "Content-Type": "text/css", 
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", 
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:134.0) Gecko/20100101 Firefox/134.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "fr,fr-FR;q=0.8,en-US;q=0.5,en;q=0.3",
            "Accept-Encoding": "gzip, deflate, br, zstd",
            "DNT": "1",
            "Sec-GPC": "1",
            "Alt-Used": "fonts.googleapis.com",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Priority": "u=0, i",
            "TE": "trailers"
        }
    )
    if response.status_code == 200:
        css_content = response.text
    else:
        raise Exception(f"Échec du téléchargement du fichier CSS depuis {css_file}")
    
    matches = font_face_pattern.findall(css_content)

    if matches:
        if len(matches) == 0 or matches[0][1] is None or matches[0][1] == "" or matches[0][1] == " ":
            raise Exception("No font family found in the CSS file")
        
        first_font_family_safe = matches[0][1].replace(" ", "_").replace("'", "")

        if output_dir is None:
            print(f"Using {first_font_family_safe} as output directory")
            output_dir = first_font_family_safe

    os.makedirs(output_dir, exist_ok=True)
    last_subset = None
    last_weight = None
    last_style = None

    for font_subset, font_family, font_style, font_weight, font_url in matches:
        if last_subset != font_subset and (last_weight != font_weight or last_style != font_style):
            print(f"\n ============= {font_family} {font_weight} {font_style} ===============")
            last_subset = font_subset
            last_weight = font_weight
            last_style = font_style

        if font_subset.lower() != subset.lower():
            print(f"\033[90m- Skipping {font_subset} subset\033[0m")
            continue

        # Normaliser le nom du fichier
        font_family_safe = font_family.replace(" ", "_").replace("'", "")
        font_style_safe = font_style.replace(" ", "_")
        file_name = f"{font_family_safe}_{font_weight}_{font_style_safe}_{font_subset}.woff2"
        file_path = os.path.join(output_dir, file_name)


        print(f"\033[92m+ Found subset {font_subset} for {font_family_safe} {font_style_safe} {font_weight}\033[0m")
        print(f"\033[92m+ Downloading {font_family_safe} {font_style_safe} {font_weight} {font_subset}\033[0m")

        response = requests.get(font_url)
        if response.status_code == 200:
            with open(file_path, "wb") as font_file:
                font_file.write(response.content)
            print(f"\033[92m+ ✅ Saved under {file_path}\033[0m")
        else:
            print(f"\033[91m- Failed to download {font_url}\033[0m")

if __name__ == "__main__":
    description = "Download WOFF2 files from a CSS file."
    example_usage = """
    Example usage:
    ./font-download.py -c https://fonts.googleapis.com/css2?family=Fira+Sans:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap -s latin
    """
    parser = argparse.ArgumentParser(
        description=description,
        usage=f"font-donwload.py [-h] --css-file CSS_FILE [--subset SUBSET] [--output-dir OUTPUT_DIR]\n\n{example_usage}",
    )
    parser.add_argument("--css-file", '-c', required=True, help="Path to the CSS file containing @font-face.")
    parser.add_argument("--subset", '-s', default="latin", help="Subset of fonts to download (ex: latin, cyrillic, vietnamese, etc.).")
    parser.add_argument("--output-dir", '-o', default=None, help="Output directory to store WOFF2 files.")
    
    args = parser.parse_args()
    
    download_woff2_from_css(args.css_file, args.subset, args.output_dir)
