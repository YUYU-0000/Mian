import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { shellWorker } from './shellWorker';
export default defineConfig({plugins:[react(),shellWorker()],server:{host:'127.0.0.1',port:5173,proxy:{'/api':'http://127.0.0.1:8787','/ws':{target:'ws://127.0.0.1:8787',ws:true}}}});
