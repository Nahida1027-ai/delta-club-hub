import type { Folder } from "@/lib/club-types";

export interface FolderTreeNode extends Folder {
  children: FolderTreeNode[];
  depth: number;
}

function normalizedFolders(folders: Folder[]) {
  const ids = new Set(folders.map((folder) => folder.id));
  const originalParents = new Map(
    folders.map((folder) => [
      folder.id,
      typeof folder.parentId === "string" && ids.has(folder.parentId)
        ? folder.parentId
        : null,
    ]),
  );

  return folders.map((folder) => {
    let parentId = originalParents.get(folder.id) ?? null;
    const visited = new Set([folder.id]);
    let cursor = parentId;
    while (cursor) {
      if (visited.has(cursor)) {
        parentId = null;
        break;
      }
      visited.add(cursor);
      cursor = originalParents.get(cursor) ?? null;
    }
    return { ...folder, parentId };
  });
}

/** 根据 parentId 构建安全的文件夹树；孤儿节点和异常循环会回退到根目录。 */
export function buildFolderTree(folders: Folder[]): FolderTreeNode[] {
  const safeFolders = normalizedFolders(folders);
  const nodes = new Map<string, FolderTreeNode>(
    safeFolders.map((folder) => [folder.id, { ...folder, children: [], depth: 0 }]),
  );
  const roots: FolderTreeNode[] = [];

  safeFolders.forEach((folder) => {
    const node = nodes.get(folder.id)!;
    const parent = folder.parentId ? nodes.get(folder.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  const sortAndSetDepth = (items: FolderTreeNode[], depth: number) => {
    items.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    items.forEach((item) => {
      item.depth = depth;
      sortAndSetDepth(item.children, depth + 1);
    });
  };
  sortAndSetDepth(roots, 0);
  return roots;
}

/** 返回指定文件夹的全部子孙 ID，不包含文件夹自身。 */
export function getDescendantFolderIds(folders: Folder[], folderId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  folders.forEach((folder) => {
    const parentId = folder.parentId ?? null;
    if (!parentId) return;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), folder.id]);
  });

  const descendants: string[] = [];
  const visited = new Set<string>([folderId]);
  const pending = [...(childrenByParent.get(folderId) ?? [])];
  while (pending.length) {
    const current = pending.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    descendants.push(current);
    pending.push(...(childrenByParent.get(current) ?? []));
  }
  return descendants;
}

/** 判断 targetId 是否位于 folderId 的子树中。 */
export function isDescendant(
  folders: Folder[],
  folderId: string,
  targetId: string | null,
): boolean {
  return Boolean(targetId && getDescendantFolderIds(folders, folderId).includes(targetId));
}
