import { assertUserMotion, type UserMotion, type UserMotionAsset } from './user-motion.ts';
import { assertResourceHeader, modelResourceId, type ModelResource } from '../resources/project-resources.ts';
import { unpackModelFiles } from '../resources/model-package.ts';
import {
    deleteDirectorMotion,
    downloadDirectorLibraryFile,
    getDirectorMotion,
    listDirectorMotions,
    saveDirectorMotion,
    uploadDirectorLibraryFile,
} from '../../api.ts';
import { externalizeTree, hydrateTree } from '../../documentFiles.ts';

export async function listUserMotions(query = '') {
    const listed = await listDirectorMotions(query);
    return listed.items as UserMotion[];
}
export async function getUserMotion(id: string): Promise<UserMotionAsset> {
    const value = await getDirectorMotion(id);
    const resource = await hydrateTree(value.resource, downloadDirectorLibraryFile) as ModelResource;
    const motion = value.motion as UserMotion;
    if (!resource) throw Error('用户动作不存在，请重新查询动作库');
    assertUserMotion(motion);
    return { motion, resource };
}
export async function saveUserMotion(motion: UserMotion, resource: ModelResource) {
    assertUserMotion(motion); assertResourceHeader(resource); unpackModelFiles(resource.package);
    if (resource.id !== motion.data.resourceId || await modelResourceId(resource.package) !== resource.id) throw Error('动作资源内容与标识不匹配');
    const slim = await externalizeTree(resource, uploadDirectorLibraryFile);
    await saveDirectorMotion(motion.id, { motion, resource: slim });
}
export async function removeUserMotion(id: string) {
    await deleteDirectorMotion(id);
}
