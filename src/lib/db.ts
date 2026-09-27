import type { Assignment, List, StoredVector } from "./lists";
import type { Post } from "./types";

const DB_NAME = "bkmrks";
const POSTS = "posts";
const META = "meta";
const LISTS = "lists";
const ASSIGNMENTS = "assignments";
const VECTORS = "vectors";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const names = req.result.objectStoreNames;
      if (!names.contains(POSTS)) req.result.createObjectStore(POSTS, { keyPath: "id" });
      if (!names.contains(META)) req.result.createObjectStore(META);
      if (!names.contains(LISTS)) req.result.createObjectStore(LISTS, { keyPath: "id" });
      if (!names.contains(ASSIGNMENTS)) req.result.createObjectStore(ASSIGNMENTS, { keyPath: "postId" });
      if (!names.contains(VECTORS)) req.result.createObjectStore(VECTORS, { keyPath: "postId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadPosts(): Promise<Post[]> {
  const db = await open();
  return result(db.transaction(POSTS).objectStore(POSTS).getAll() as IDBRequest<Post[]>);
}

export async function putPosts(posts: Post[], meta?: Record<string, unknown>, remove: string[] = []): Promise<void> {
  const db = await open();
  const tx = db.transaction([POSTS, META], "readwrite");
  const store = tx.objectStore(POSTS);
  for (const id of remove) store.delete(id);
  for (const p of posts) store.put(p);
  if (meta) for (const [k, v] of Object.entries(meta)) tx.objectStore(META).put(v, k);
  return done(tx);
}

export async function loadLists(): Promise<List[]> {
  const db = await open();
  return result(db.transaction(LISTS).objectStore(LISTS).getAll() as IDBRequest<List[]>);
}

export async function putLists(lists: List[], remove: string[] = []): Promise<void> {
  const db = await open();
  const tx = db.transaction(LISTS, "readwrite");
  const store = tx.objectStore(LISTS);
  for (const id of remove) store.delete(id);
  for (const l of lists) store.put(l);
  return done(tx);
}

export async function loadAssignments(): Promise<Assignment[]> {
  const db = await open();
  return result(db.transaction(ASSIGNMENTS).objectStore(ASSIGNMENTS).getAll() as IDBRequest<Assignment[]>);
}

export async function putAssignments(assignments: Assignment[], remove: string[] = []): Promise<void> {
  const db = await open();
  const tx = db.transaction(ASSIGNMENTS, "readwrite");
  const store = tx.objectStore(ASSIGNMENTS);
  for (const id of remove) store.delete(id);
  for (const a of assignments) store.put(a);
  return done(tx);
}

export async function loadVectors(): Promise<StoredVector[]> {
  const db = await open();
  return result(db.transaction(VECTORS).objectStore(VECTORS).getAll() as IDBRequest<StoredVector[]>);
}

export async function putVectors(vectors: StoredVector[], remove: string[] = []): Promise<void> {
  const db = await open();
  const tx = db.transaction(VECTORS, "readwrite");
  const store = tx.objectStore(VECTORS);
  for (const id of remove) store.delete(id);
  for (const v of vectors) store.put(v);
  return done(tx);
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return result(db.transaction(META).objectStore(META).get(key) as IDBRequest<T | undefined>);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await open();
  const tx = db.transaction(META, "readwrite");
  tx.objectStore(META).put(value, key);
  return done(tx);
}

export async function clearAll(): Promise<void> {
  const db = await open();
  const tx = db.transaction([POSTS, META, LISTS, ASSIGNMENTS, VECTORS], "readwrite");
  tx.objectStore(POSTS).clear();
  tx.objectStore(META).clear();
  tx.objectStore(LISTS).clear();
  tx.objectStore(ASSIGNMENTS).clear();
  tx.objectStore(VECTORS).clear();
  return done(tx);
}
