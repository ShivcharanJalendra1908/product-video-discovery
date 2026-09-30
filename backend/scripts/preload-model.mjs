// Runs at Docker build time to pre-download the CLIP model into the image.
// This eliminates the 150MB download at runtime, preventing OOM on Render free tier.
import { pipeline, env } from '@xenova/transformers';
env.cacheDir = process.env.MODEL_CACHE || '/app/models';
console.log('Pre-downloading CLIP model into image...');
await pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');
console.log('CLIP model cached successfully.');
process.exit(0);
