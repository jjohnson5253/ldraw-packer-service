import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const execAsync = promisify(exec);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb' }));

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// LDraw setup
const ldrawPath = process.env.HOME + '/ldraw/';
const materialsFileName = 'LDConfig.ldr';

// Initialize LDraw library on startup
async function initializeLDraw() {
  try {
    console.log('🚀 Initializing LDraw library...');
    
    // Check if LDraw library already exists
    if (fs.existsSync(ldrawPath)) {
      console.log('✅ LDraw library already exists at:', ldrawPath);
      return;
    }
    
    console.log('📥 Downloading LDraw library...');
    const commands = [
      `cd ${process.env.HOME}`,
      'wget -q https://library.ldraw.org/library/updates/complete.zip',
      'unzip -q complete.zip',
      'rm complete.zip'
    ];
    
    await execAsync(commands.join(' && '));
    console.log('✅ LDraw library downloaded and extracted to:', ldrawPath);
    
  } catch (error) {
    console.error('❌ Error initializing LDraw library:', error);
    throw error;
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'ldraw-packer-service',
    ldrawPath: ldrawPath,
    ldrawExists: fs.existsSync(ldrawPath)
  });
});

// Pack LDraw model endpoint
app.post('/pack', upload.single('model'), async (req, res) => {
  try {
    let modelContent;
    let fileName;
    
    // Handle file upload or direct content
    if (req.file) {
      fileName = req.file.originalname || 'model.ldr';
      modelContent = fs.readFileSync(req.file.path, 'utf8');
    } else if (req.body) {
      fileName = req.headers['x-filename'] || 'model.ldr';
      modelContent = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    } else {
      return res.status(400).json({ error: 'No model data provided' });
    }
    
    console.log(`📦 Packing model: ${fileName}`);
    
    // Create temporary file for processing
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempFilePath = path.join(tempDir, fileName);
    fs.writeFileSync(tempFilePath, modelContent);
    
    // Pack the model using our adapted logic
    const packedContent = await packLDrawModel(tempFilePath);
    
    // Clean up temporary files
    fs.unlinkSync(tempFilePath);
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    
    res.json({
      success: true,
      fileName: fileName,
      packedFileName: fileName + '_Packed.mpd',
      packedContent: packedContent
    });
    
  } catch (error) {
    console.error('❌ Packing error:', error);
    res.status(500).json({ 
      error: 'Failed to pack model', 
      details: error.message 
    });
  }
});

// Adapted packLDrawModel function
async function packLDrawModel(fileName) {
  const materialsFilePath = path.join(ldrawPath, materialsFileName);
  
  if (!fs.existsSync(materialsFilePath)) {
    throw new Error(`Materials file not found: ${materialsFilePath}`);
  }
  
  console.log('Loading materials file:', materialsFilePath);
  const materialsContent = fs.readFileSync(materialsFilePath, { encoding: 'utf8' });
  
  console.log('Packing:', fileName);
  
  const objectsPaths = [];
  const objectsContents = [];
  const pathMap = {};
  const listOfNotFound = [];
  
  // Parse object tree
  parseObject(fileName, true, objectsPaths, objectsContents, pathMap, listOfNotFound);
  
  // Check if previously files not found are found now
  let someNotFound = false;
  for (let i = 0; i < listOfNotFound.length; i++) {
    if (!pathMap[listOfNotFound[i]]) {
      someNotFound = true;
      console.log('Error: File object not found:', listOfNotFound[i]);
    }
  }
  
  if (someNotFound) {
    throw new Error('Some files were not found during packing');
  }
  
  // Obtain packed content
  let packedContent = materialsContent + '\n';
  for (let i = objectsPaths.length - 1; i >= 0; i--) {
    packedContent += objectsContents[i];
  }
  packedContent += '\n';
  
  return packedContent;
}

function parseObject(fileName, isRoot, objectsPaths, objectsContents, pathMap, listOfNotFound) {
  console.log('Adding:', fileName);
  
  const originalFileName = fileName;
  let prefix = '';
  let objectContent = null;
  
  // For root files, try to read directly from the given path first
  if (isRoot) {
    try {
      objectContent = fs.readFileSync(fileName, { encoding: 'utf8' });
      console.log('Successfully read root file from:', fileName);
    } catch (e) {
      console.log('Could not read root file directly, trying LDraw structure...');
    }
  }
  
  // If we haven't read the content yet, try the LDraw directory structure
  if (!objectContent) {
    for (let attempt = 0; attempt < 2; attempt++) {
      prefix = '';
      
      if (attempt === 1) {
        fileName = fileName.toLowerCase();
      }
      
      if (fileName.startsWith('48/')) {
        prefix = 'p/';
      } else if (fileName.startsWith('s/')) {
        prefix = 'parts/';
      }
      
      let absoluteObjectPath = path.join(ldrawPath, fileName);
      
      try {
        objectContent = fs.readFileSync(absoluteObjectPath, { encoding: 'utf8' });
        break;
      } catch (e) {
        prefix = 'parts/';
        absoluteObjectPath = path.join(ldrawPath, prefix, fileName);
        
        try {
          objectContent = fs.readFileSync(absoluteObjectPath, { encoding: 'utf8' });
          break;
        } catch (e) {
          prefix = 'p/';
          absoluteObjectPath = path.join(ldrawPath, prefix, fileName);
          
          try {
            objectContent = fs.readFileSync(absoluteObjectPath, { encoding: 'utf8' });
            break;
          } catch (e) {
            try {
              prefix = 'models/';
              absoluteObjectPath = path.join(ldrawPath, prefix, fileName);
              objectContent = fs.readFileSync(absoluteObjectPath, { encoding: 'utf8' });
              break;
            } catch (e) {
              if (attempt === 1) {
                listOfNotFound.push(originalFileName);
              }
            }
          }
        }
      }
    }
  }
  
  const objectPath = path.join(prefix, fileName).trim().replace(/\\/g, '/');
  
  if (!objectContent) {
    return null;
  }
  
  if (objectContent.indexOf('\r\n') !== -1) {
    objectContent = objectContent.replace(/\r\n/g, '\n');
  }
  
  let processedObjectContent = isRoot ? '' : '0 FILE ' + objectPath + '\n';
  const lines = objectContent.split('\n');
  
  for (let i = 0, n = lines.length; i < n; i++) {
    let line = lines[i];
    let lineLength = line.length;
    
    // Skip spaces/tabs
    let charIndex = 0;
    while ((line.charAt(charIndex) === ' ' || line.charAt(charIndex) === '\t') && charIndex < lineLength) {
      charIndex++;
    }
    
    line = line.substring(charIndex);
    lineLength = line.length;
    charIndex = 0;
    
    if (line.startsWith('0 FILE ')) {
      if (i === 0) {
        continue;
      }
      
      const subobjectFileName = line.substring(7).trim().replace(/\\/g, '/');
      
      if (subobjectFileName) {
        const subobjectPath = pathMap[subobjectFileName];
        
        if (!subobjectPath) {
          pathMap[subobjectFileName] = subobjectFileName;
        }
      }
      
      processedObjectContent += line + '\n';
      continue;
    }
    
    if (line.startsWith('1 ')) {
      // Parse reference line
      let tokens = line.trim().split(/\s+/);
      
      if (tokens.length >= 15) {
        const subobjectFileName = tokens.slice(14).join(' ').trim().replace(/\\/g, '/');
        
        if (subobjectFileName && !pathMap[subobjectFileName]) {
          const subobjectPath = parseObject(subobjectFileName, false, objectsPaths, objectsContents, pathMap, listOfNotFound);
          
          if (subobjectPath) {
            pathMap[subobjectFileName] = subobjectPath;
          }
        }
      }
    }
    
    processedObjectContent += line + '\n';
  }
  
  objectsPaths.push(objectPath);
  objectsContents.push(processedObjectContent);
  
  return objectPath;
}

// Start server
app.listen(port, async () => {
  try {
    await initializeLDraw();
    console.log(`🚀 LDraw Packer Service running on port ${port}`);
  } catch (error) {
    console.error('❌ Failed to start service:', error);
    process.exit(1);
  }
});