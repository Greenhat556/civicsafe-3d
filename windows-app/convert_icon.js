const fs = require('fs');
const path = require('path');
const { Jimp } = require('jimp');
const pngToIco = require('png-to-ico');

const pngPath = path.join(__dirname, '..', 'app_logo.png');
const tempSquarePath = path.join(__dirname, 'temp_square_logo.png');
const icoPath = path.join(__dirname, 'icon.ico');

async function convert() {
  console.log(`Reading source logo from ${pngPath}...`);
  if (!fs.existsSync(pngPath)) {
    console.error(`Error: Source logo file not found at ${pngPath}`);
    process.exit(1);
  }

  try {
    // Read image using Jimp
    const image = await Jimp.read(pngPath);
    
    // Find the max dimension to make it a perfect square
    const maxDimension = Math.max(image.width, image.height);
    console.log(`Original dimensions: ${image.width}x${image.height}. Padding to ${maxDimension}x${maxDimension}...`);
    
    // Make the image a square using contain
    image.contain({ w: maxDimension, h: maxDimension });
    
    // Write temporary square PNG
    await image.write(tempSquarePath);
    console.log(`Temporary square image written to ${tempSquarePath}.`);
    
    // Convert to ICO
    console.log(`Converting square PNG to ICO...`);
    const icoBuf = await pngToIco(tempSquarePath);
    
    // Write ICO file
    fs.writeFileSync(icoPath, icoBuf);
    console.log(`Icon successfully saved to ${icoPath}.`);
    
    // Clean up temporary file
    if (fs.existsSync(tempSquarePath)) {
      fs.unlinkSync(tempSquarePath);
    }
    console.log('Cleaned up temporary files. Conversion complete!');
  } catch (error) {
    console.error('Error during conversion process:', error);
    if (fs.existsSync(tempSquarePath)) {
      fs.unlinkSync(tempSquarePath);
    }
    process.exit(1);
  }
}

convert();
