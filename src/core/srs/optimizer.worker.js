import { optimizeParameters } from './training.js';
self.onmessage = ({ data }) => {
    if (data.type !== 'START_OPTIMIZATION') return;
    try {
        const result = optimizeParameters(data.payload.logs, data.payload.vocabulary, data.payload.params);
        self.postMessage({ type: 'OPTIMIZATION_COMPLETE', payload: result });
    } catch (error) { self.postMessage({ type: 'ERROR', payload: error.message }); }
};