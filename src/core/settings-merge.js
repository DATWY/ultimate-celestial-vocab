import { validFsrs7Params } from './srs/constants.js';
export function mergeLearningSettings(local, remote) {
    const normalize = value => ({ ...value, userFsrs7Params: validFsrs7Params(value?.userFsrs7Params) ? value.userFsrs7Params : null,
        trainedAt: Math.max(Number(value?.trainedAt) || 0, Number(value?.userFsrs7TrainedAt) || 0) });
    const a = normalize(local), b = normalize(remote);
    if (a.trainedAt !== b.trainedAt) return a.trainedAt > b.trainedAt ? a : b;
    return JSON.stringify(a.userFsrs7Params) >= JSON.stringify(b.userFsrs7Params) ? a : b;
}
