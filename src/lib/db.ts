import type { Post } from "./types";

const DB_NAME = "bkmrks";
const POSTS = "posts";
const META = "meta";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(POSTS, { keyPath: "id" });
      req.result.createObjectStore(META);
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
  for (const p of posts) store.put(p);
  for (const id of remove) store.delete(id);
  if (meta) for (const [k, v] of Object.entries(meta)) tx.objectStore(META).put(v, k);
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
  const tx = db.transaction([POSTS, META], "readwrite");
  tx.objectStore(POSTS).clear();
  tx.objectStore(META).clear();
  return done(tx);
}
