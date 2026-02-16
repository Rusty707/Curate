import { openDB } from 'idb'

const DB_NAME = 'canvas-db'
const STORE_NAME = 'images'

export async function getDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    },
  })
}

export async function initDB() {
  return getDB()
}

export async function saveImage(id, fileBlob) {
  const db = await getDB()
  await db.put(STORE_NAME, fileBlob, id)
}

export async function getImage(id) {
  const db = await getDB()
  return db.get(STORE_NAME, id)
}

export async function deleteImage(id) {
  const db = await getDB()
  return db.delete(STORE_NAME, id)
}
