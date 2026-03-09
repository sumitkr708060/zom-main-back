const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const isRealValue = (val) => {
    if (!val) return false;
    const normalized = String(val).trim().toLowerCase();
    if (!normalized) return false;
    if (normalized.includes('your_') || normalized.includes('your-')) return false;
    if (normalized.includes('placeholder')) return false;
    if (normalized === '...') return false;
    return true;
};

const hasCloudinaryConfig = isRealValue(process.env.CLOUDINARY_CLOUD_NAME)
    && isRealValue(process.env.CLOUDINARY_API_KEY)
    && isRealValue(process.env.CLOUDINARY_API_SECRET);

if (hasCloudinaryConfig) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
    });
}

const projectRoot = path.join(__dirname, '..');
const uploadsRoot = path.join(projectRoot, 'uploads');
const productsDir = path.join(uploadsRoot, 'products');
const vendorsDir = path.join(uploadsRoot, 'vendors');
const avatarsDir = path.join(uploadsRoot, 'avatars');

const ensureDir = (dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

ensureDir(productsDir);
ensureDir(vendorsDir);
ensureDir(avatarsDir);

const localDiskStorage = (destination) => multer.diskStorage({
    destination,
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext.toLowerCase()}`;
        cb(null, name);
    },
});

const imageFileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
        return;
    }
    cb(new Error('Only image files are allowed'), false);
};

const uploadBufferToCloudinary = (file, options) => new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
        if (error) {
            reject(error);
            return;
        }
        resolve(result);
    });
    stream.on('error', reject);
    stream.end(file.buffer);
});

const getRequestFiles = (req) => {
    if (req.file) return [req.file];
    if (Array.isArray(req.files)) return req.files;
    if (req.files && typeof req.files === 'object') {
        return Object.values(req.files).flat();
    }
    return [];
};

const wrapCloudinaryUpload = (middleware, options) => (req, res, next) => {
    middleware(req, res, async (err) => {
        if (err) {
            next(err);
            return;
        }

        try {
            const files = getRequestFiles(req);
            await Promise.all(files.map(async (file) => {
                if (!file?.buffer) return;
                const result = await uploadBufferToCloudinary(file, options);
                file.path = result.secure_url;
                file.filename = result.public_id;
                file.cloudinary = result;
                delete file.buffer;
            }));
            next();
        } catch (uploadError) {
            next(uploadError);
        }
    });
};

const createImageUploader = ({ destination, cloudinaryOptions, limits }) => {
    const storage = hasCloudinaryConfig ? multer.memoryStorage() : localDiskStorage(destination);
    const uploader = multer({
        storage,
        limits,
        fileFilter: imageFileFilter,
    });

    if (!hasCloudinaryConfig) {
        return uploader;
    }

    return {
        single: (fieldName) => wrapCloudinaryUpload(uploader.single(fieldName), cloudinaryOptions),
        array: (fieldName, maxCount) => wrapCloudinaryUpload(uploader.array(fieldName, maxCount), cloudinaryOptions),
        fields: (fields) => wrapCloudinaryUpload(uploader.fields(fields), cloudinaryOptions),
    };
};

const uploadProduct = createImageUploader({
    destination: productsDir,
    cloudinaryOptions: {
        folder: 'zomitron/products',
        resource_type: 'image',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [
            { width: 800, height: 800, crop: 'limit', quality: 'auto:good' },
        ],
    },
    limits: { fileSize: 5 * 1024 * 1024 },
});

const uploadVendor = createImageUploader({
    destination: vendorsDir,
    cloudinaryOptions: {
        folder: 'zomitron/vendors',
        resource_type: 'image',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [
            { width: 400, height: 400, crop: 'fill', quality: 'auto:good' },
        ],
    },
    limits: { fileSize: 5 * 1024 * 1024 },
});

const uploadAvatar = createImageUploader({
    destination: avatarsDir,
    cloudinaryOptions: {
        folder: 'zomitron/avatars',
        resource_type: 'image',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [
            { width: 200, height: 200, crop: 'fill', quality: 'auto:good' },
        ],
    },
    limits: { fileSize: 2 * 1024 * 1024 },
});

const uploadCSV = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['text/csv', 'application/vnd.ms-excel', 'application/csv', 'text/plain'];
        if (allowedMimes.includes(file.mimetype) || file.originalname.toLowerCase().endsWith('.csv')) {
            cb(null, true);
            return;
        }
        cb(new Error('Only CSV files are allowed'), false);
    },
});

const toUploadUrl = (file) => {
    if (!file) return null;
    if (file.path && /^https?:\/\//i.test(file.path)) return file.path;
    if (file.filename && file.destination) {
        const relative = path.relative(projectRoot, path.join(file.destination, file.filename));
        return `/${relative.replace(/\\/g, '/')}`;
    }
    if (file.path) {
        const normalized = String(file.path).replace(/\\/g, '/');
        const uploadsIdx = normalized.indexOf('/uploads/');
        if (uploadsIdx >= 0) return normalized.slice(uploadsIdx);
    }
    return null;
};

module.exports = { cloudinary, uploadProduct, uploadVendor, uploadAvatar, uploadCSV, toUploadUrl };
