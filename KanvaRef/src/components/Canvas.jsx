import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignLeft,
  AlignRight,
  AlignStartVertical as AlignTop,
  AlignEndVertical as AlignBottom,
  Clipboard,
  Crop,
  Download,
  Grid2x2,
  Check,
  LayoutGrid,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  SendHorizontal,
  Plus,
  RotateCcw,
  StretchHorizontal,
  StretchVertical,
  Trash2,
  Unlock,
  ChevronRight,
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { nanoid } from 'nanoid'
import { generateBoardId } from '../utils/id'
import { deleteImage, getImage, saveImage } from '../storage/imageDB'
import './Canvas.css'

const MIN_SCALE = 0.2
const MAX_SCALE = 4
const ZOOM_STEP = 0.1
const DEFAULT_IMAGE_MAX = 320
const MIN_IMAGE_SIZE = 40
const IMAGE_SPACING = 24
const MARQUEE_CLICK_THRESHOLD = 3
const GRID_SIZE = 24
const PASTE_OFFSET_STEP = 20
const HISTORY_LIMIT = 20
const MIN_CROP_RECT_SIZE = 16
const MIN_CLUSTER_SIZE = 24
const MENU_ICON_SIZE = 18
const ICON_STROKE_WIDTH = 2.3
const SMART_SNAP_THRESHOLD = 5
const ZIP_FILE_SIGNATURE = 0x04034b50
const ZIP_CENTRAL_SIGNATURE = 0x02014b50
const ZIP_END_SIGNATURE = 0x06054b50
const COMMENT_POPUP_OFFSET = 14
const COMMENT_PANEL_VIEWPORT_PADDING = 16
const COMMENT_PANEL_FALLBACK_WIDTH = 272
const COMMENT_PANEL_FALLBACK_HEIGHT = 152
const COMMENT_COLORS = ['#F87171', '#FBBF24', '#34D399', '#60A5FA', '#A78BFA', '#F472B6']
const DEFAULT_COMMENT_COLOR = '#60A5FA'
const PASTE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const STORAGE_KEY = 'canvas-board-v1'
const MAX_IMAGE_DIMENSION = 4096
const IMAGE_COMPRESSION_QUALITY = 0.8

function normalizeImageComment(comment) {
  if (!comment || typeof comment !== 'object') return null
  const rawX = typeof comment.position?.x === 'number' ? comment.position.x : comment.x
  const rawY = typeof comment.position?.y === 'number' ? comment.position.y : comment.y
  return {
    id: typeof comment.id === 'string' ? comment.id : crypto.randomUUID(),
    text: typeof comment.text === 'string' ? comment.text : '',
    position: {
      x: clamp(typeof rawX === 'number' ? rawX : 0.5, 0, 1),
      y: clamp(typeof rawY === 'number' ? rawY : 0.5, 0, 1),
    },
    isDraft: Boolean(comment.isDraft),
    createdAt: typeof comment.createdAt === 'string' ? comment.createdAt : new Date().toISOString(),
    color: typeof comment.color === 'string' && comment.color ? comment.color : DEFAULT_COMMENT_COLOR,
  }
}

async function saveBlobForImage(id, blob) {
  await saveImage(id, blob)
  return URL.createObjectURL(blob)
}

async function getImageBlobById(id) {
  if (!id || typeof id !== 'string') return null
  return getImage(id)
}

async function deleteImageBlobById(id) {
  if (!id || typeof id !== 'string') return
  await deleteImage(id)
}

function stripImageForStorage(image) {
  if (!image || typeof image !== 'object') return image
  return {
    id: image.id,
    x: image.x,
    y: image.y,
    width: image.width,
    height: image.height,
    clusterId: image.clusterId ?? null,
  }
}

function hasCommentText(text) {
  return typeof text === 'string' && text.trim().length > 0
}

function normalizeBoardComment(comment) {
  if (!comment || typeof comment !== 'object') return null
  return {
    id: typeof comment.id === 'string' ? comment.id : crypto.randomUUID(),
    text: typeof comment.text === 'string' ? comment.text : '',
    position: {
      x: typeof comment.position?.x === 'number' ? comment.position.x : 0,
      y: typeof comment.position?.y === 'number' ? comment.position.y : 0,
    },
    isDraft: Boolean(comment.isDraft),
    createdAt: typeof comment.createdAt === 'string' ? comment.createdAt : new Date().toISOString(),
    color: typeof comment.color === 'string' && comment.color ? comment.color : DEFAULT_COMMENT_COLOR,
    zIndex: typeof comment.zIndex === 'number' ? comment.zIndex : 0,
    parentId: typeof comment.parentId === 'string' && comment.parentId ? comment.parentId : null,
  }
}

function normalizeCluster(cluster) {
  if (!cluster || typeof cluster !== 'object') return null
  const rawBounds = cluster.bounds && typeof cluster.bounds === 'object' ? cluster.bounds : null
  const x = typeof rawBounds?.x === 'number' ? rawBounds.x : typeof cluster.x === 'number' ? cluster.x : 0
  const y = typeof rawBounds?.y === 'number' ? rawBounds.y : typeof cluster.y === 'number' ? cluster.y : 0
  const width = typeof rawBounds?.width === 'number' ? rawBounds.width : typeof cluster.width === 'number' ? cluster.width : 0
  const height = typeof rawBounds?.height === 'number' ? rawBounds.height : typeof cluster.height === 'number' ? cluster.height : 0
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width <= 0 || height <= 0) return null
  const createdAt = typeof cluster.createdAt === 'number' ? cluster.createdAt : Date.now()
  const updatedAt = typeof cluster.updatedAt === 'number' ? cluster.updatedAt : createdAt
  const rawName = typeof cluster.name === 'string' && cluster.name.trim()
    ? cluster.name.trim()
    : typeof cluster.title === 'string' && cluster.title.trim()
      ? cluster.title.trim()
      : 'Cluster'
  const name = rawName.slice(0, 80)
  return {
    id: typeof cluster.id === 'string' ? cluster.id : crypto.randomUUID(),
    name,
    title: name,
    bounds: { x, y, width, height },
    x,
    y,
    width,
    height,
    itemIds: Array.isArray(cluster.itemIds)
      ? cluster.itemIds.filter((itemId) => typeof itemId === 'string' && itemId)
      : [],
    createdAt,
    updatedAt,
  }
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

function makeImageItem(src, x, y, width, height) {
  return {
    id: nanoid(),
    type: 'image',
    src,
    originalSrc: src,
    originalWidth: width,
    originalHeight: height,
    cropBounds: null,
    scale: 1,
    rotation: 0,
    comments: [],
    clusterId: null,
    x,
    y,
    width,
    height,
  }
}

function normalizeImageItem(image) {
  if (!image || typeof image !== 'object') return image
  const width = typeof image.width === 'number' ? image.width : DEFAULT_IMAGE_MAX
  const height = typeof image.height === 'number' ? image.height : DEFAULT_IMAGE_MAX
  return {
    ...image,
    id: typeof image.id === 'string' && image.id ? image.id : crypto.randomUUID(),
    type: 'image',
    originalSrc: image.originalSrc || image.src,
    originalWidth: typeof image.originalWidth === 'number' ? image.originalWidth : width,
    originalHeight: typeof image.originalHeight === 'number' ? image.originalHeight : height,
    cropBounds: image.cropBounds ?? null,
    scale: typeof image.scale === 'number' ? image.scale : 1,
    rotation: typeof image.rotation === 'number' ? image.rotation : 0,
    comments: Array.isArray(image.comments) ? image.comments.map(normalizeImageComment).filter(Boolean) : [],
    clusterId:
      typeof image.clusterId === 'string' && image.clusterId
        ? image.clusterId
        : typeof image.sectionId === 'string' && image.sectionId
          ? image.sectionId
          : null,
  }
}

function deriveBoardCommentsFromImages(images) {
  const comments = []
  for (const image of images) {
    const size = getImageSize(image)
    for (const rawComment of image.comments ?? []) {
      const normalized = normalizeImageComment(rawComment)
      if (!normalized) continue
      comments.push({
        id: normalized.id,
        text: normalized.text,
        position: {
          x: normalized.position.x * size.width,
          y: normalized.position.y * size.height,
        },
        isDraft: normalized.isDraft,
        createdAt: normalized.createdAt,
        parentId: image.id,
      })
    }
  }
  return comments
}

function getCommentWorldPosition(comment, images) {
  const localX = typeof comment?.position?.x === 'number' ? comment.position.x : 0
  const localY = typeof comment?.position?.y === 'number' ? comment.position.y : 0
  if (!comment?.parentId) return { x: localX, y: localY }
  const parent = images.find((image) => image.id === comment.parentId)
  if (!parent) return { x: localX, y: localY }
  return { x: parent.x + localX, y: parent.y + localY }
}

function getImageDimensions(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Failed to load image dimensions'))
    img.src = src
  })
}

async function getImageDimensionsFromFile(file) {
  const objectUrl = URL.createObjectURL(file)
  try {
    return await getImageDimensions(objectUrl)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode image'))
          return
        }
        resolve(blob)
      },
      type,
      quality,
    )
  })
}

// Compress and constrain large images before they enter app state/storage.
async function processImage(file) {
  const bitmap = await createImageBitmap(file)
  try {
    const sourceWidth = bitmap.width
    const sourceHeight = bitmap.height
    if (!sourceWidth || !sourceHeight) return file
    const maxSide = Math.max(sourceWidth, sourceHeight)
    const scale = maxSide > MAX_IMAGE_DIMENSION ? MAX_IMAGE_DIMENSION / maxSide : 1
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale))
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)

    try {
      return await canvasToBlob(canvas, 'image/webp', IMAGE_COMPRESSION_QUALITY)
    } catch {
      try {
        return await canvasToBlob(canvas, 'image/jpeg', IMAGE_COMPRESSION_QUALITY)
      } catch {
        return file
      }
    }
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close()
  }
}

async function blobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer())
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function serializeImagesForStorage(images) {
  return images.map((image) => stripImageForStorage(image))
}

function computeClusterBoundsFromItemIds(itemIds, imageById, fallbackBounds = { x: 0, y: 0, width: 1, height: 1 }) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const itemId of itemIds) {
    const image = imageById.get(itemId)
    if (!image) continue
    const size = getImageSize(image)
    minX = Math.min(minX, image.x)
    minY = Math.min(minY, image.y)
    maxX = Math.max(maxX, image.x + size.width)
    maxY = Math.max(maxY, image.y + size.height)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return {
      x: fallbackBounds.x,
      y: fallbackBounds.y,
      width: Math.max(1, fallbackBounds.width),
      height: Math.max(1, fallbackBounds.height),
    }
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function rehydrateBoardState(images, comments, clusters) {
  const normalizedImages = (Array.isArray(images) ? images : []).map(normalizeImageItem).filter(Boolean)
  const normalizedClusters = (Array.isArray(clusters) ? clusters : []).map(normalizeCluster).filter(Boolean)
  const imageById = new Map(normalizedImages.map((image) => [image.id, image]))
  const validClusterIds = new Set(normalizedClusters.map((cluster) => cluster.id))
  const imageClusterMap = new Map()

  for (const image of normalizedImages) {
    if (image.clusterId && validClusterIds.has(image.clusterId)) {
      imageClusterMap.set(image.id, image.clusterId)
    }
  }

  for (const cluster of normalizedClusters) {
    for (const itemId of cluster.itemIds ?? []) {
      if (!imageById.has(itemId)) continue
      if (!imageClusterMap.has(itemId)) imageClusterMap.set(itemId, cluster.id)
    }
  }

  const hydratedImages = normalizedImages.map((image) => ({
    ...image,
    clusterId: imageClusterMap.get(image.id) ?? null,
  }))
  const hydratedImageById = new Map(hydratedImages.map((image) => [image.id, image]))
  const now = Date.now()
  const hydratedClusters = normalizedClusters.map((cluster) => {
    const itemIds = hydratedImages.filter((image) => image.clusterId === cluster.id).map((image) => image.id)
    const fallback = {
      x: typeof cluster.bounds?.x === 'number' ? cluster.bounds.x : cluster.x,
      y: typeof cluster.bounds?.y === 'number' ? cluster.bounds.y : cluster.y,
      width: typeof cluster.bounds?.width === 'number' ? cluster.bounds.width : cluster.width,
      height: typeof cluster.bounds?.height === 'number' ? cluster.bounds.height : cluster.height,
    }
    const bounds = computeClusterBoundsFromItemIds(itemIds, hydratedImageById, fallback)
    const name = typeof cluster.name === 'string' && cluster.name.trim() ? cluster.name.trim().slice(0, 80) : 'Cluster'
    return {
      ...cluster,
      name,
      title: name,
      itemIds,
      bounds,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      createdAt: typeof cluster.createdAt === 'number' ? cluster.createdAt : now,
      updatedAt: typeof cluster.updatedAt === 'number' ? cluster.updatedAt : now,
    }
  })

  return {
    images: hydratedImages,
    comments: (Array.isArray(comments) ? comments : []).map(normalizeBoardComment).filter(Boolean),
    clusters: hydratedClusters,
  }
}

function serializeClustersForStorage(clusters, images) {
  const normalizedClusters = (Array.isArray(clusters) ? clusters : []).map(normalizeCluster).filter(Boolean)
  const normalizedImages = (Array.isArray(images) ? images : []).map(normalizeImageItem).filter(Boolean)
  const imageById = new Map(normalizedImages.map((image) => [image.id, image]))
  const syncedClusters = syncClusterItems(normalizedClusters, normalizedImages)
  return syncedClusters.map((cluster) => {
    const fallback = {
      x: typeof cluster.bounds?.x === 'number' ? cluster.bounds.x : cluster.x,
      y: typeof cluster.bounds?.y === 'number' ? cluster.bounds.y : cluster.y,
      width: typeof cluster.bounds?.width === 'number' ? cluster.bounds.width : cluster.width,
      height: typeof cluster.bounds?.height === 'number' ? cluster.bounds.height : cluster.height,
    }
    const bounds = computeClusterBoundsFromItemIds(cluster.itemIds ?? [], imageById, fallback)
    const name = typeof cluster.name === 'string' && cluster.name.trim() ? cluster.name.trim().slice(0, 80) : 'Cluster'
    return {
      id: cluster.id,
      name,
      title: name,
      itemIds: cluster.itemIds ?? [],
      bounds,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      createdAt: typeof cluster.createdAt === 'number' ? cluster.createdAt : Date.now(),
      updatedAt: typeof cluster.updatedAt === 'number' ? cluster.updatedAt : Date.now(),
    }
  })
}

function serializeCommentsForStorage(comments) {
  return (Array.isArray(comments) ? comments : [])
    .filter((comment) => !(comment?.isDraft && !hasCommentText(comment?.text)))
    .map((comment) => ({
      ...comment,
      text: typeof comment.text === 'string' ? comment.text : '',
      position: {
        x: typeof comment.position?.x === 'number' ? comment.position.x : 0,
        y: typeof comment.position?.y === 'number' ? comment.position.y : 0,
      },
      zIndex: typeof comment?.zIndex === 'number' ? comment.zIndex : 0,
      color: typeof comment?.color === 'string' && comment.color ? comment.color : DEFAULT_COMMENT_COLOR,
      parentId: typeof comment?.parentId === 'string' && comment.parentId ? comment.parentId : null,
    }))
}

function toCanvasObjects(images, comments) {
  const imageObjects = (Array.isArray(images) ? images : []).map((image, index) => ({
    id: image.id,
    type: 'image',
    x: typeof image.x === 'number' ? image.x : 0,
    y: typeof image.y === 'number' ? image.y : 0,
    zIndex: typeof image.zIndex === 'number' ? image.zIndex : index,
    data: {
      ...image,
      comments: [],
      id: undefined,
      x: undefined,
      y: undefined,
      zIndex: undefined,
    },
  }))

  const maxImageZ = imageObjects.reduce((max, object) => Math.max(max, object.zIndex), -1)
  const commentObjects = (Array.isArray(comments) ? comments : []).map((comment, index) => {
    const world = getCommentWorldPosition(comment, images)
    return {
    id: comment.id,
    type: 'comment',
    x: world.x,
    y: world.y,
    zIndex: typeof comment.zIndex === 'number' ? comment.zIndex : maxImageZ + 1 + index,
    data: {
      text: typeof comment.text === 'string' ? comment.text : '',
      isDraft: Boolean(comment.isDraft),
      createdAt: typeof comment.createdAt === 'string' ? comment.createdAt : new Date().toISOString(),
      color: typeof comment.color === 'string' && comment.color ? comment.color : DEFAULT_COMMENT_COLOR,
      parentId: typeof comment.parentId === 'string' && comment.parentId ? comment.parentId : null,
      offset:
        typeof comment.parentId === 'string' && comment.parentId
          ? {
              x: typeof comment.position?.x === 'number' ? comment.position.x : 0,
              y: typeof comment.position?.y === 'number' ? comment.position.y : 0,
            }
          : null,
    },
  }
  })

  return [...imageObjects, ...commentObjects].sort((a, b) => a.zIndex - b.zIndex)
}

function parseCanvasObjects(objects) {
  if (!Array.isArray(objects)) return { images: [], comments: [], clusters: [] }
  const normalized = objects
    .map((object, index) => ({
      id: typeof object?.id === 'string' ? object.id : crypto.randomUUID(),
      type: object?.type === 'comment' ? 'comment' : 'image',
      x: typeof object?.x === 'number' ? object.x : 0,
      y: typeof object?.y === 'number' ? object.y : 0,
      zIndex: typeof object?.zIndex === 'number' ? object.zIndex : index,
      data: object?.data && typeof object.data === 'object' ? object.data : {},
    }))
    .sort((a, b) => a.zIndex - b.zIndex)

  const imageObjects = normalized.filter((object) => object.type === 'image')
  const imagePositions = new Map(
    imageObjects.map((object) => [
      object.id,
      { x: typeof object.x === 'number' ? object.x : 0, y: typeof object.y === 'number' ? object.y : 0 },
    ]),
  )

  const images = []
  const comments = []
  for (const object of normalized) {
    if (object.type === 'comment') {
      const parentId = typeof object.data.parentId === 'string' && object.data.parentId ? object.data.parentId : null
      const hasOffset =
        typeof object.data.offset?.x === 'number' &&
        typeof object.data.offset?.y === 'number'
      const parentPos = parentId ? imagePositions.get(parentId) : null
      const localPosition = parentId
        ? hasOffset
          ? { x: object.data.offset.x, y: object.data.offset.y }
          : parentPos
            ? { x: object.x - parentPos.x, y: object.y - parentPos.y }
            : { x: object.x, y: object.y }
        : { x: object.x, y: object.y }
      comments.push(
        normalizeBoardComment({
          id: object.id,
          text: object.data.text,
          position: localPosition,
          isDraft: object.data.isDraft,
          createdAt: object.data.createdAt,
          color: object.data.color,
          zIndex: object.zIndex,
          parentId,
        }),
      )
      continue
    }
    images.push(
      normalizeImageItem({
        ...object.data,
        id: object.id,
        x: object.x,
        y: object.y,
      }),
    )
  }
  return {
    images: images.filter(Boolean),
    comments: comments.filter(Boolean),
    clusters: [],
  }
}

function parseBoardState(raw) {
  if (!raw) return { images: [], comments: [], clusters: [] }
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      const images = parsed.map(normalizeImageItem)
      const comments = deriveBoardCommentsFromImages(images).map(normalizeBoardComment).filter(Boolean)
      return rehydrateBoardState(images, comments, [])
    }
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.objects) && parsed.objects.length > 0) {
        const parsedObjects = parseCanvasObjects(parsed.objects)
        const rawClusters = Array.isArray(parsed.clusters) ? parsed.clusters : Array.isArray(parsed.sections) ? parsed.sections : []
        const fallbackImages = Array.isArray(parsed.images) ? parsed.images.map(normalizeImageItem).filter(Boolean) : []
        const fallbackComments = Array.isArray(parsed.comments)
          ? parsed.comments.map(normalizeBoardComment).filter(Boolean)
          : deriveBoardCommentsFromImages(fallbackImages).map(normalizeBoardComment).filter(Boolean)
        const images = parsedObjects.images.length > 0 ? parsedObjects.images : fallbackImages
        const comments = parsedObjects.comments.length > 0 ? parsedObjects.comments : fallbackComments
        return rehydrateBoardState(images, comments, rawClusters)
      }
      const images = Array.isArray(parsed.images) ? parsed.images.map(normalizeImageItem) : []
      const comments = Array.isArray(parsed.comments)
        ? parsed.comments.map(normalizeBoardComment).filter(Boolean)
        : deriveBoardCommentsFromImages(images).map(normalizeBoardComment).filter(Boolean)
      const rawClusters = Array.isArray(parsed.clusters) ? parsed.clusters : Array.isArray(parsed.sections) ? parsed.sections : []
      return rehydrateBoardState(images, comments, rawClusters)
    }
  } catch {
    return { images: [], comments: [], clusters: [] }
  }
  return { images: [], comments: [], clusters: [] }
}

function fitWithinMax(width, height, maxSize = DEFAULT_IMAGE_MAX) {
  const ratio = Math.min(maxSize / width, maxSize / height, 1)
  return { width: width * ratio, height: height * ratio }
}

function toCanvasPoint(clientX, clientY, rect, offsetX, offsetY, scale) {
  return { x: (clientX - rect.left - offsetX) / scale, y: (clientY - rect.top - offsetY) / scale }
}

function getImageSize(image) {
  return { width: image.width ?? DEFAULT_IMAGE_MAX, height: image.height ?? DEFAULT_IMAGE_MAX }
}

function getRenderedImageBounds(image, naturalSize) {
  const box = getImageSize(image)
  const sourceWidth = naturalSize?.width
  const sourceHeight = naturalSize?.height
  if (!sourceWidth || !sourceHeight) {
    return { x: image.x, y: image.y, width: box.width, height: box.height }
  }

  const boxRatio = box.width / box.height
  const sourceRatio = sourceWidth / sourceHeight
  if (sourceRatio > boxRatio) {
    const width = box.width
    const height = width / sourceRatio
    return { x: image.x, y: image.y + (box.height - height) / 2, width, height }
  }

  const height = box.height
  const width = height * sourceRatio
  return { x: image.x + (box.width - width) / 2, y: image.y, width, height }
}

function hasActiveTransformCrop(image) {
  return Boolean(image?.cropBounds)
}

function hasQuickCropApplied(image) {
  return Boolean(image?.originalSrc) && image.src !== image.originalSrc
}

function hasNonDefaultImageTransform(image) {
  return (image?.scale ?? 1) !== 1 || (image?.rotation ?? 0) !== 0
}

function canResetCropOrTransform(image) {
  return hasActiveTransformCrop(image) || hasQuickCropApplied(image) || hasNonDefaultImageTransform(image)
}

function intersects(rect, image) {
  const size = getImageSize(image)
  const imageRect = { left: image.x, right: image.x + size.width, top: image.y, bottom: image.y + size.height }
  return !(
    imageRect.left > rect.right ||
    imageRect.right < rect.left ||
    imageRect.top > rect.bottom ||
    imageRect.bottom < rect.top
  )
}

function snapToGrid(value, gridSize) {
  return Math.round(value / gridSize) * gridSize
}

function getDraggedGroupBounds(images, draggedIds, initialPositions, dx, dy) {
  const imageMap = new Map(images.map((image) => [image.id, image]))
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const id of draggedIds) {
    const image = imageMap.get(id)
    const start = initialPositions[id]
    if (!image || !start) continue
    const size = getImageSize(image)
    const left = start.x + dx
    const top = start.y + dy
    const right = left + size.width
    const bottom = top + size.height
    minX = Math.min(minX, left)
    minY = Math.min(minY, top)
    maxX = Math.max(maxX, right)
    maxY = Math.max(maxY, bottom)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }

  return { minX, minY, maxX, maxY }
}

function getBoundsFromImage(image, x = image.x, y = image.y, width = image.width, height = image.height) {
  return {
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    width,
    height,
  }
}

function getBoundsFromCluster(cluster) {
  const x = typeof cluster?.bounds?.x === 'number' ? cluster.bounds.x : cluster.x
  const y = typeof cluster?.bounds?.y === 'number' ? cluster.bounds.y : cluster.y
  const width = typeof cluster?.bounds?.width === 'number' ? cluster.bounds.width : cluster.width
  const height = typeof cluster?.bounds?.height === 'number' ? cluster.bounds.height : cluster.height
  return {
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    width,
    height,
  }
}

function getIntersectionArea(a, b) {
  const left = Math.max(a.left, b.left)
  const right = Math.min(a.right, b.right)
  const top = Math.max(a.top, b.top)
  const bottom = Math.min(a.bottom, b.bottom)
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) return 0
  return width * height
}

function getBestClusterIdForImageBounds(imageBounds, clusters) {
  const containing = []
  for (const cluster of clusters) {
    const clusterBounds = getBoundsFromCluster(cluster)
    const isContained =
      imageBounds.left >= clusterBounds.left &&
      imageBounds.right <= clusterBounds.right &&
      imageBounds.top >= clusterBounds.top &&
      imageBounds.bottom <= clusterBounds.bottom
    if (isContained) containing.push(cluster.id)
  }
  if (containing.length === 0) return null
  return containing[containing.length - 1]
}

function getClusterIdByContainment(imageBounds, clusters, currentClusterId = null) {
  const containing = []
  for (const cluster of clusters) {
    const clusterBounds = getBoundsFromCluster(cluster)
    const isContained =
      imageBounds.left >= clusterBounds.left &&
      imageBounds.right <= clusterBounds.right &&
      imageBounds.top >= clusterBounds.top &&
      imageBounds.bottom <= clusterBounds.bottom
    if (isContained) containing.push(cluster.id)
  }
  if (containing.length === 0) return null
  if (currentClusterId && containing.includes(currentClusterId)) return currentClusterId
  return containing[containing.length - 1]
}

function assignClusterIdToImage(image, clusters) {
  const size = getImageSize(image)
  const bounds = getBoundsFromImage(image, image.x, image.y, size.width, size.height)
  return getClusterIdByContainment(bounds, clusters, image.clusterId ?? null)
}

function syncClusterItems(clusters, images) {
  const byCluster = new Map()
  for (const image of images) {
    if (!image.clusterId) continue
    if (!byCluster.has(image.clusterId)) byCluster.set(image.clusterId, [])
    byCluster.get(image.clusterId).push(image.id)
  }
  return clusters.map((cluster) => {
    const itemIds = byCluster.get(cluster.id) ?? []
    if (JSON.stringify(cluster.itemIds ?? []) === JSON.stringify(itemIds)) return cluster
    return { ...cluster, itemIds, updatedAt: Date.now() }
  })
}

function getNextClusterName(clusters) {
  let max = 0
  for (const cluster of clusters) {
    const name = typeof cluster?.name === 'string' ? cluster.name.trim() : ''
    const match = /^Cluster\s+(\d+)$/i.exec(name)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `Cluster ${max + 1}`
}

function getSmartSnapResult(images, dragState, dx, dy, threshold = SMART_SNAP_THRESHOLD) {
  const draggedSet = new Set(dragState.draggedIds)
  const draggedBounds = getDraggedGroupBounds(images, dragState.draggedIds, dragState.initialPositions, dx, dy)
  if (!draggedBounds) {
    return { dx, dy, guides: { vertical: null, horizontal: null } }
  }

  const draggedCenterX = (draggedBounds.minX + draggedBounds.maxX) / 2
  const draggedCenterY = (draggedBounds.minY + draggedBounds.maxY) / 2

  let bestX = null
  let bestY = null

  for (const image of images) {
    if (draggedSet.has(image.id)) continue
    const size = getImageSize(image)
    const targetBounds = {
      left: image.x,
      top: image.y,
      right: image.x + size.width,
      bottom: image.y + size.height,
      centerX: image.x + size.width / 2,
      centerY: image.y + size.height / 2,
    }

    const xCandidates = [
      { delta: targetBounds.left - draggedBounds.minX, target: targetBounds.left, targetBounds, type: 'left-left' },
      { delta: targetBounds.right - draggedBounds.maxX, target: targetBounds.right, targetBounds, type: 'right-right' },
      { delta: targetBounds.centerX - draggedCenterX, target: targetBounds.centerX, targetBounds, type: 'center-x' },
    ]
    for (const candidate of xCandidates) {
      const distance = Math.abs(candidate.delta)
      if (distance > threshold) continue
      if (!bestX || distance < bestX.distance) {
        bestX = { ...candidate, distance }
      }
    }

    const yCandidates = [
      { delta: targetBounds.top - draggedBounds.minY, target: targetBounds.top, targetBounds, type: 'top-top' },
      { delta: targetBounds.bottom - draggedBounds.maxY, target: targetBounds.bottom, targetBounds, type: 'bottom-bottom' },
      { delta: targetBounds.centerY - draggedCenterY, target: targetBounds.centerY, targetBounds, type: 'center-y' },
    ]
    for (const candidate of yCandidates) {
      const distance = Math.abs(candidate.delta)
      if (distance > threshold) continue
      if (!bestY || distance < bestY.distance) {
        bestY = { ...candidate, distance }
      }
    }
  }

  const nextDx = dx + (bestX ? bestX.delta : 0)
  const nextDy = dy + (bestY ? bestY.delta : 0)
  const adjustedBounds = getDraggedGroupBounds(images, dragState.draggedIds, dragState.initialPositions, nextDx, nextDy)

  return {
    dx: nextDx,
    dy: nextDy,
    guides: {
      vertical:
        bestX && adjustedBounds
          ? {
              x: bestX.target,
              top: Math.min(adjustedBounds.minY, bestX.targetBounds.top),
              bottom: Math.max(adjustedBounds.maxY, bestX.targetBounds.bottom),
            }
          : null,
      horizontal:
        bestY && adjustedBounds
          ? {
              y: bestY.target,
              left: Math.min(adjustedBounds.minX, bestY.targetBounds.left),
              right: Math.max(adjustedBounds.maxX, bestY.targetBounds.right),
            }
          : null,
    },
  }
}

function isTypingTarget(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

function packRows(items, startX, startY, maxRowWidth, spacing) {
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0
  return items.map((item) => {
    if (cursorX > 0 && cursorX + item.width > maxRowWidth) {
      cursorX = 0
      cursorY += rowHeight + spacing
      rowHeight = 0
    }
    const next = { ...item, x: startX + cursorX, y: startY + cursorY }
    cursorX += item.width + spacing
    rowHeight = Math.max(rowHeight, item.height)
    return next
  })
}

function getFileExtensionFromMime(mimeType) {
  const map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
  }
  return map[mimeType] || 'png'
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(dataUrl)
  if (!match) return null
  const mimeType = match[1] || 'image/png'
  const isBase64 = Boolean(match[2])
  const payload = match[3] || ''
  if (isBase64) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return { mimeType, bytes }
  }
  const decoded = decodeURIComponent(payload)
  return { mimeType, bytes: new TextEncoder().encode(decoded) }
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true)
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value, true)
}

function createZipBlob(files) {
  const encoder = new TextEncoder()
  const localParts = []
  const centralParts = []
  let localOffset = 0
  let centralSize = 0

  files.forEach((file) => {
    const fileNameBytes = encoder.encode(file.name)
    const data = file.bytes
    const fileCrc = crc32(data)
    const dataSize = data.length

    const localHeader = new Uint8Array(30 + fileNameBytes.length)
    const localView = new DataView(localHeader.buffer)
    writeUint32(localView, 0, ZIP_FILE_SIGNATURE)
    writeUint16(localView, 4, 20)
    writeUint16(localView, 6, 0)
    writeUint16(localView, 8, 0)
    writeUint16(localView, 10, 0)
    writeUint16(localView, 12, 0)
    writeUint32(localView, 14, fileCrc)
    writeUint32(localView, 18, dataSize)
    writeUint32(localView, 22, dataSize)
    writeUint16(localView, 26, fileNameBytes.length)
    writeUint16(localView, 28, 0)
    localHeader.set(fileNameBytes, 30)
    localParts.push(localHeader, data)

    const centralHeader = new Uint8Array(46 + fileNameBytes.length)
    const centralView = new DataView(centralHeader.buffer)
    writeUint32(centralView, 0, ZIP_CENTRAL_SIGNATURE)
    writeUint16(centralView, 4, 20)
    writeUint16(centralView, 6, 20)
    writeUint16(centralView, 8, 0)
    writeUint16(centralView, 10, 0)
    writeUint16(centralView, 12, 0)
    writeUint16(centralView, 14, 0)
    writeUint32(centralView, 16, fileCrc)
    writeUint32(centralView, 20, dataSize)
    writeUint32(centralView, 24, dataSize)
    writeUint16(centralView, 28, fileNameBytes.length)
    writeUint16(centralView, 30, 0)
    writeUint16(centralView, 32, 0)
    writeUint16(centralView, 34, 0)
    writeUint16(centralView, 36, 0)
    writeUint32(centralView, 38, 0)
    writeUint32(centralView, 42, localOffset)
    centralHeader.set(fileNameBytes, 46)
    centralParts.push(centralHeader)
    centralSize += centralHeader.length

    localOffset += localHeader.length + dataSize
  })

  const endRecord = new Uint8Array(22)
  const endView = new DataView(endRecord.buffer)
  writeUint32(endView, 0, ZIP_END_SIGNATURE)
  writeUint16(endView, 4, 0)
  writeUint16(endView, 6, 0)
  writeUint16(endView, 8, files.length)
  writeUint16(endView, 10, files.length)
  writeUint32(endView, 12, centralSize)
  writeUint32(endView, 16, localOffset)
  writeUint16(endView, 20, 0)

  return new Blob([...localParts, ...centralParts, endRecord], { type: 'application/zip' })
}

function MenuIcon({ children }) {
  return (
    <span className="canvas-menu-item__icon" aria-hidden="true">
      {children}
    </span>
  )
}

function WorldOrigin() {
  return <div className="canvas-world-origin" aria-hidden="true" />
}

export function Canvas() {
  const navigate = useNavigate()
  const { id: boardId } = useParams()
  const legacyStorageKey = `curate-board-${boardId}`
  const storageKey = STORAGE_KEY
  const snappingStorageKey = `curate-board-snap-${boardId}`
  const imageSnappingStorageKey = `curate-board-snap-images-${boardId}`

  const [images, setImages] = useState([])
  const [comments, setComments] = useState([])
  const [clusters, setClusters] = useState([])
  const [scale, setScale] = useState(1)
  const [offsetX, setOffsetX] = useState(0)
  const [offsetY, setOffsetY] = useState(0)
  const [selectedImageIds, setSelectedImageIds] = useState([])
  const [dragState, setDragState] = useState(null)
  const [clusterDragState, setClusterDragState] = useState(null)
  const [clusterDrawState, setClusterDrawState] = useState(null)
  const [commentDragState, setCommentDragState] = useState(null)
  const [resizeState, setResizeState] = useState(null)
  const [panState, setPanState] = useState(null)
  const [marqueeState, setMarqueeState] = useState(null)
  const [menuState, setMenuState] = useState(null)
  const [isSpaceDown, setIsSpaceDown] = useState(false)
  const [isSnappingEnabled, setIsSnappingEnabled] = useState(() => localStorage.getItem(snappingStorageKey) === 'true')
  const [isImageSnappingEnabled, setIsImageSnappingEnabled] = useState(() => {
    const saved = localStorage.getItem(imageSnappingStorageKey)
    return saved === null ? true : saved === 'true'
  })
  const [internalClipboard, setInternalClipboard] = useState(null)
  const [pasteCount, setPasteCount] = useState(0)
  const [history, setHistory] = useState([])
  const [future, setFuture] = useState([])
  const [isCanvasLocked, setIsCanvasLocked] = useState(false)
  const canPan = !isCanvasLocked
  const canZoom = !isCanvasLocked
  const canTransform = !isCanvasLocked
  const canComment = true
  const [cropMode, setCropMode] = useState(null)
  const [cropInteraction, setCropInteraction] = useState(null)
  const [isQuickCropKeyDown, setIsQuickCropKeyDown] = useState(false)
  const [quickCropState, setQuickCropState] = useState(null)
  const [isCommentMode, setIsCommentMode] = useState(false)
  const [isClusterMode, setIsClusterMode] = useState(false)
  const [selectedClusterId, setSelectedClusterId] = useState(null)
  const [openClusterMenuId, setOpenClusterMenuId] = useState(null)
  const [editingClusterId, setEditingClusterId] = useState(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [activeCommentRef, setActiveCommentRef] = useState(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [commentSaveState, setCommentSaveState] = useState('idle')
  const [commentEditorSize, setCommentEditorSize] = useState({ width: COMMENT_PANEL_FALLBACK_WIDTH, height: COMMENT_PANEL_FALLBACK_HEIGHT })
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 720 : window.innerHeight,
  }))
  const [imageNaturalSizes, setImageNaturalSizes] = useState({})
  const [smartGuides, setSmartGuides] = useState({ vertical: null, horizontal: null })
  const [pasteFeedback, setPasteFeedback] = useState('')
  const [lockFeedback, setLockFeedback] = useState('')
  const [isPasteAvailable, setIsPasteAvailable] = useState(false)

  const canvasRef = useRef(null)
  const menuRef = useRef(null)
  const commentEditorRef = useRef(null)
  const commentInitialTextRef = useRef('')
  const commentSaveTimerRef = useRef(null)
  const suppressCommentPinClickRef = useRef(false)
  const lockFeedbackTimerRef = useRef(null)
  const lockFeedbackLastAtRef = useRef(0)
  const skipClusterTitleBlurRef = useRef(false)
  const scaleRef = useRef(scale)
  const offsetXRef = useRef(offsetX)
  const offsetYRef = useRef(offsetY)
  const imagesRef = useRef(images)
  const commentsRef = useRef(comments)
  const clustersRef = useRef(clusters)
  const selectedIdsRef = useRef(selectedImageIds)
  const historyRef = useRef(history)
  const futureRef = useRef(future)
  const applyCropByRectRef = useRef(null)
  const didHydrateRef = useRef(false)
  const previousImageSrcsRef = useRef(new Map())
  const persistCountRef = useRef(0)

  async function restoreBoard() {
    try {
      const saved = localStorage.getItem(storageKey) || localStorage.getItem(legacyStorageKey) || null
      const parsed = parseBoardState(saved)
      const hydratedImages = await Promise.all(
        (Array.isArray(parsed.images) ? parsed.images : []).map(async (rawImage) => {
          const image = normalizeImageItem(rawImage)
          try {
            const blob = await getImageBlobById(image.id)
            if (!blob) return { ...image, src: null, originalSrc: null }
            const objectUrl = URL.createObjectURL(blob)
            return { ...image, src: objectUrl, originalSrc: objectUrl }
          } catch {
            return { ...image, src: null, originalSrc: null }
          }
        }),
      )
      setComments(Array.isArray(parsed.comments) ? parsed.comments : [])
      setClusters(Array.isArray(parsed.clusters) ? parsed.clusters : [])
      setImages(hydratedImages)
      console.log('[Curate] Hydrated board once', {
        imagesCount: hydratedImages.length,
        clustersCount: parsed.clusters?.length ?? 0,
        storageKey,
      })
    } catch (error) {
      console.error('[Curate] Failed to load board:', error)
    }
  }

  useEffect(() => {
    if (didHydrateRef.current) return
    didHydrateRef.current = true
    void restoreBoard()
  }, [])

  useEffect(() => {
    scaleRef.current = scale
    offsetXRef.current = offsetX
    offsetYRef.current = offsetY
  }, [scale, offsetX, offsetY])
  useEffect(() => {
    imagesRef.current = images
  }, [images])
  useEffect(() => {
    commentsRef.current = comments
  }, [comments])
  useEffect(() => {
    clustersRef.current = clusters
  }, [clusters])
  useEffect(() => {
    setClusters((prev) => {
      const next = syncClusterItems(prev, imagesRef.current)
      const changed =
        next.length !== prev.length ||
        next.some((cluster, index) => cluster !== prev[index])
      return changed ? next : prev
    })
  }, [images])
  useEffect(() => {
    const previous = previousImageSrcsRef.current
    const next = new Map(images.map((image) => [image.id, image.src]))
    for (const [id, prevSrc] of previous.entries()) {
      const nextSrc = next.get(id)
      if (prevSrc && prevSrc.startsWith('blob:') && prevSrc !== nextSrc) {
        URL.revokeObjectURL(prevSrc)
      }
    }
    previousImageSrcsRef.current = next
  }, [images])

  useEffect(
    () => () => {
      for (const src of previousImageSrcsRef.current.values()) {
        if (src && src.startsWith('blob:')) URL.revokeObjectURL(src)
      }
    },
    [],
  )

  useEffect(() => {
    selectedIdsRef.current = selectedImageIds
  }, [selectedImageIds])
  useEffect(() => {
    historyRef.current = history
  }, [history])
  useEffect(() => {
    futureRef.current = future
  }, [future])
  useEffect(() => {
    if (!pasteFeedback) return
    const timer = window.setTimeout(() => {
      setPasteFeedback('')
    }, 1400)
    return () => window.clearTimeout(timer)
  }, [pasteFeedback])

  useEffect(() => {
    if (!lockFeedback) return
    if (lockFeedbackTimerRef.current) window.clearTimeout(lockFeedbackTimerRef.current)
    lockFeedbackTimerRef.current = window.setTimeout(() => {
      setLockFeedback('')
      lockFeedbackTimerRef.current = null
    }, 2000)
    return () => {
      if (lockFeedbackTimerRef.current) {
        window.clearTimeout(lockFeedbackTimerRef.current)
        lockFeedbackTimerRef.current = null
      }
    }
  }, [lockFeedback])

  useEffect(() => {
    return () => {
      if (commentSaveTimerRef.current) window.clearTimeout(commentSaveTimerRef.current)
      if (lockFeedbackTimerRef.current) window.clearTimeout(lockFeedbackTimerRef.current)
    }
  }, [])

  function showLockBlockedFeedback() {
    const now = Date.now()
    if (now - lockFeedbackLastAtRef.current < 1000) return
    lockFeedbackLastAtRef.current = now
    setLockFeedback('Canvas is locked. Unlock to make changes.')
  }

  useEffect(() => {
    function handleResize() {
      setViewportSize({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useLayoutEffect(() => {
    if (!activeCommentRef || !commentEditorRef.current) return
    const rect = commentEditorRef.current.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    setCommentEditorSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
  }, [activeCommentRef, commentDraft, viewportSize.width, viewportSize.height])

  useEffect(() => {
    if (!activeCommentRef) return
    const comment = comments.find((item) => item.id === activeCommentRef.commentId)
    if (!comment) {
      setActiveCommentRef(null)
      setCommentDraft('')
    }
  }, [activeCommentRef, comments])

  useEffect(() => {
    if (!cropMode) return
    if (selectedImageIds.length !== 1 || selectedImageIds[0] !== cropMode.id) {
      cancelCropMode()
      return
    }
    const exists = images.some((image) => image.id === cropMode.id)
    if (!exists) cancelCropMode()
  }, [cropMode, selectedImageIds, images])

  useEffect(() => {
    if (dragState) return
    setSmartGuides((prev) => (prev.vertical || prev.horizontal ? { vertical: null, horizontal: null } : prev))
  }, [dragState])

  useEffect(() => {
    try {
      const persistedClusters = serializeClustersForStorage(clusters, images)
      const boardState = {
        images: serializeImagesForStorage(images),
        comments: serializeCommentsForStorage(comments),
        clusters: persistedClusters,
      }
      persistCountRef.current += 1
      console.log('[Curate] Persisting board state', { persistCount: persistCountRef.current, imageCount: boardState.images.length })
      localStorage.setItem(
        storageKey,
        JSON.stringify(boardState),
      )
      localStorage.setItem(
        legacyStorageKey,
        JSON.stringify(boardState),
      )
    } catch (error) {
      console.error('[Curate] Failed to persist board:', error)
    }
  }, [images, comments, clusters, storageKey, legacyStorageKey])

  useEffect(() => {
    console.log('[Curate] Loaded board state', {
      imagesCount: images.length,
      clustersCount: clusters.length,
      storageKey,
    })
  }, [])

  useEffect(() => {
    setIsSnappingEnabled(localStorage.getItem(snappingStorageKey) === 'true')
  }, [snappingStorageKey])

  useEffect(() => {
    localStorage.setItem(snappingStorageKey, String(isSnappingEnabled))
  }, [snappingStorageKey, isSnappingEnabled])

  useEffect(() => {
    const saved = localStorage.getItem(imageSnappingStorageKey)
    setIsImageSnappingEnabled(saved === null ? true : saved === 'true')
  }, [imageSnappingStorageKey])

  useEffect(() => {
    localStorage.setItem(imageSnappingStorageKey, String(isImageSnappingEnabled))
  }, [imageSnappingStorageKey, isImageSnappingEnabled])

  function commitHistory(previousImages, previousSelected, previousComments = commentsRef.current, previousClusters = clustersRef.current) {
    // Called only for meaningful operations, so push this snapshot directly.
    setHistory((prev) => {
      const next = [...prev, { images: previousImages, comments: previousComments, clusters: previousClusters, selectedImageIds: previousSelected }]
      return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
    })
    setFuture([])
  }

  function hasSnapshotChanged(snapshot) {
    if (!snapshot) return false
    return (
      JSON.stringify(snapshot.images) !== JSON.stringify(imagesRef.current) ||
      JSON.stringify(snapshot.comments ?? commentsRef.current) !== JSON.stringify(commentsRef.current) ||
      JSON.stringify(snapshot.clusters ?? clustersRef.current) !== JSON.stringify(clustersRef.current) ||
      JSON.stringify(snapshot.selectedImageIds) !== JSON.stringify(selectedIdsRef.current)
    )
  }

  function getImageBounds(image) {
    const size = getImageSize(image)
    return { left: image.x, top: image.y, right: image.x + size.width, bottom: image.y + size.height, width: size.width, height: size.height }
  }

  function getRenderableImageSrc(src) {
    return typeof src === 'string' && src.length > 0 ? src : null
  }

  function openCommentEditor(commentId) {
    const comment = commentsRef.current.find((item) => item.id === commentId)
    if (!comment) return
    setActiveCommentRef({ commentId })
    const nextDraft = comment.text ?? ''
    setCommentDraft(nextDraft)
    commentInitialTextRef.current = nextDraft
    setCommentSaveState('idle')
  }

  function closeCommentEditor() {
    setActiveCommentRef(null)
    setCommentDraft('')
    commentInitialTextRef.current = ''
    setCommentSaveState('idle')
  }

  function closeCommentEditorFromOutside() {
    handleSaveComment()
    closeCommentEditor()
  }

  function handleCommentDraftChange(nextValue) {
    setCommentDraft(nextValue)
    if (!activeCommentRef?.commentId || !hasCommentText(nextValue)) return
    const comment = commentsRef.current.find((item) => item.id === activeCommentRef.commentId)
    if (!comment?.isDraft) return
    const prevComments = commentsRef.current
    const prevSelected = selectedIdsRef.current
    setComments((prev) =>
      prev.map((entry) =>
        entry.id === activeCommentRef.commentId ? { ...entry, isDraft: false, text: nextValue } : entry,
      ),
    )
    commitHistory(imagesRef.current, prevSelected, prevComments)
    commentInitialTextRef.current = nextValue
    showCommentSavedFeedback()
  }

  function showCommentSavedFeedback() {
    setCommentSaveState('saved')
    if (commentSaveTimerRef.current) window.clearTimeout(commentSaveTimerRef.current)
    commentSaveTimerRef.current = window.setTimeout(() => {
      setCommentSaveState('idle')
      commentSaveTimerRef.current = null
    }, 900)
  }

  function enterCropMode(imageId) {
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    const image = imagesRef.current.find((item) => item.id === imageId)
    if (!image) return
    const size = getImageSize(image)
    setCropInteraction(null)
    setCropMode({
      id: imageId,
      rect: { x: image.x, y: image.y, width: size.width, height: size.height },
      historySnapshot: { images: imagesRef.current, selectedImageIds: selectedIdsRef.current },
    })
    setMenuState(null)
  }

  function cancelCropMode() {
    setCropInteraction(null)
    setCropMode(null)
  }

  async function applyCropByRect(imageId, rect, historySnapshot) {
    const image = imagesRef.current.find((item) => item.id === imageId)
    if (!image) {
      return false
    }
    if (
      !rect ||
      typeof rect.x !== 'number' ||
      typeof rect.y !== 'number' ||
      typeof rect.width !== 'number' ||
      typeof rect.height !== 'number' ||
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height)
    ) {
      return false
    }
    const bounds = getImageBounds(image)
    const left = clamp(rect.x, bounds.left, bounds.right)
    const top = clamp(rect.y, bounds.top, bounds.bottom)
    const right = clamp(rect.x + rect.width, bounds.left, bounds.right)
    const bottom = clamp(rect.y + rect.height, bounds.top, bounds.bottom)
    const cropWidth = right - left
    const cropHeight = bottom - top
    if (!Number.isFinite(cropWidth) || !Number.isFinite(cropHeight) || cropWidth <= 1 || cropHeight <= 1) {
      return false
    }
    try {
      const img = new Image()
      const sourceSrc = getRenderableImageSrc(image.src)
      if (!sourceSrc) return false
      img.src = sourceSrc
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
      })
      const displaySize = getImageSize(image)
      const scaleX = img.naturalWidth / displaySize.width
      const scaleY = img.naturalHeight / displaySize.height
      if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
        return false
      }
      const sx = Math.max(0, (left - image.x) * scaleX)
      const sy = Math.max(0, (top - image.y) * scaleY)
      const sw = Math.min(img.naturalWidth - sx, cropWidth * scaleX)
      const sh = Math.min(img.naturalHeight - sy, cropHeight * scaleY)
      if (!Number.isFinite(sw) || !Number.isFinite(sh) || sw <= 1 || sh <= 1) {
        return false
      }
      const canvas = document.createElement('canvas')
      const outputWidth = Math.max(1, Math.round(sw))
      const outputHeight = Math.max(1, Math.round(sh))
      if (outputWidth <= 1 || outputHeight <= 1) {
        return false
      }
      canvas.width = outputWidth
      canvas.height = outputHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        return false
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
      const croppedBlob = await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Failed to encode crop'))
            return
          }
          resolve(blob)
        }, 'image/png')
      })
      const croppedSrc = await saveBlobForImage(image.id, croppedBlob)
      setImages((prev) =>
        prev.map((item) =>
          item.id === image.id
            ? { ...item, src: croppedSrc, x: left, y: top, width: cropWidth, height: cropHeight }
            : item,
        ),
      )
      commitHistory(historySnapshot.images, historySnapshot.selectedImageIds)
      return true
    } catch {
      // Ignore crop failure and keep source image.
      return false
    }
  }

  async function confirmCropMode() {
    if (!cropMode) return
    const mode = cropMode
    const didCrop = await applyCropByRect(mode.id, mode.rect, mode.historySnapshot)
    if (didCrop) {
      cancelCropMode()
    }
  }
  applyCropByRectRef.current = applyCropByRect

  function undo() {
    const prevHistory = historyRef.current
    if (prevHistory.length === 0) return false
    const previousState = prevHistory[prevHistory.length - 1]
    const currentState = { images: imagesRef.current, comments: commentsRef.current, clusters: clustersRef.current, selectedImageIds: selectedIdsRef.current }
    const nextHistory = prevHistory.slice(0, -1)
    const nextFuture = [...futureRef.current, currentState]
    const clampedFuture = nextFuture.length > HISTORY_LIMIT ? nextFuture.slice(nextFuture.length - HISTORY_LIMIT) : nextFuture
    historyRef.current = nextHistory
    futureRef.current = clampedFuture
    setHistory(nextHistory)
    setFuture(clampedFuture)
    setImages(previousState.images)
    setComments(previousState.comments ?? commentsRef.current)
    setClusters(previousState.clusters ?? clustersRef.current)
    setSelectedImageIds(previousState.selectedImageIds)
    setMenuState(null)
    return true
  }

  function redo() {
    const prevFuture = futureRef.current
    if (prevFuture.length === 0) return false
    const nextState = prevFuture[prevFuture.length - 1]
    const currentState = { images: imagesRef.current, comments: commentsRef.current, clusters: clustersRef.current, selectedImageIds: selectedIdsRef.current }
    const nextFuture = prevFuture.slice(0, -1)
    const nextHistory = [...historyRef.current, currentState]
    const clampedHistory = nextHistory.length > HISTORY_LIMIT ? nextHistory.slice(nextHistory.length - HISTORY_LIMIT) : nextHistory
    historyRef.current = clampedHistory
    futureRef.current = nextFuture
    setHistory(clampedHistory)
    setFuture(nextFuture)
    setImages(nextState.images)
    setComments(nextState.comments ?? commentsRef.current)
    setClusters(nextState.clusters ?? clustersRef.current)
    setSelectedImageIds(nextState.selectedImageIds)
    setMenuState(null)
    return true
  }

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    function handleWheel(event) {
      if (!canZoom) {
        showLockBlockedFeedback()
        return
      }
      if (cropMode || quickCropState) return
      const rect = element.getBoundingClientRect()
      const currentScale = scaleRef.current
      const currentOffsetX = offsetXRef.current
      const currentOffsetY = offsetYRef.current
      const mouseX = event.clientX - rect.left
      const mouseY = event.clientY - rect.top
      const worldX = (mouseX - currentOffsetX) / currentScale
      const worldY = (mouseY - currentOffsetY) / currentScale
      const scaleFactor = Math.exp(-event.deltaY * 0.001)
      const nextScale = clamp(currentScale * scaleFactor, 0.05, 100)
      if (!Number.isFinite(nextScale) || nextScale === currentScale) return
      const nextOffsetX = mouseX - worldX * nextScale
      const nextOffsetY = mouseY - worldY * nextScale
      setScale(nextScale)
      setOffsetX(nextOffsetX)
      setOffsetY(nextOffsetY)
    }
    element.addEventListener('wheel', handleWheel)
    return () => element.removeEventListener('wheel', handleWheel)
  }, [canZoom, cropMode, quickCropState])

  useEffect(() => {
    if (!menuState) return
    function handleOutsideClick(event) {
      if (menuRef.current?.contains(event.target)) return
      setMenuState(null)
    }
    function handleEscape(event) {
      if (event.key === 'Escape') setMenuState(null)
    }
    window.addEventListener('mousedown', handleOutsideClick)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [menuState])

  useEffect(() => {
    if (!activeCommentRef) return
    function handleOutsideClick(event) {
      if (commentEditorRef.current?.contains(event.target)) return
      closeCommentEditorFromOutside()
    }
    function handleEscape(event) {
      if (event.key !== 'Escape') return
      closeCommentEditorFromOutside()
    }
    window.addEventListener('mousedown', handleOutsideClick)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [activeCommentRef, commentDraft])

  useEffect(() => {
    if (!isCommentMode) return
    function handleEscapeCommentMode(event) {
      if (event.key !== 'Escape') return
      const activeElement = document.activeElement
      const isEditorFocused =
        activeElement instanceof HTMLElement &&
        Boolean(commentEditorRef.current?.contains(activeElement))

      if (isEditorFocused) {
        event.preventDefault()
        activeElement.blur()
        return
      }

      event.preventDefault()
      setIsCommentMode(false)
      setCommentDragState(null)
      suppressCommentPinClickRef.current = false
      setMenuState(null)
      if (activeCommentRef) {
        setActiveCommentRef(null)
        setCommentDraft('')
        commentInitialTextRef.current = ''
        setCommentSaveState('idle')
      }
    }
    window.addEventListener('keydown', handleEscapeCommentMode)
    return () => {
      window.removeEventListener('keydown', handleEscapeCommentMode)
    }
  }, [activeCommentRef, isCommentMode])

  useEffect(() => {
    function handleSpace(event) {
      if (event.code === 'Space') setIsSpaceDown(event.type === 'keydown')
    }
    function handleBlur() {
      setIsSpaceDown(false)
    }
    window.addEventListener('keydown', handleSpace)
    window.addEventListener('keyup', handleSpace)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleSpace)
      window.removeEventListener('keyup', handleSpace)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  useEffect(() => {
    function handleBlur() {
      setCropInteraction(null)
      setCropMode(null)
      setQuickCropState(null)
    }
    window.addEventListener('blur', handleBlur)
    return () => window.removeEventListener('blur', handleBlur)
  }, [])

  useEffect(() => {
    function handleQuickCropKey(event) {
      if (isTypingTarget(event.target)) return
      if (event.key.toLowerCase() !== 'c') return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      setIsQuickCropKeyDown(event.type === 'keydown')
    }
    function handleBlur() {
      setIsQuickCropKeyDown(false)
      setQuickCropState(null)
    }
    window.addEventListener('keydown', handleQuickCropKey)
    window.addEventListener('keyup', handleQuickCropKey)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleQuickCropKey)
      window.removeEventListener('keyup', handleQuickCropKey)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  useEffect(() => {
    function handleLockShortcut(event) {
      if (event.repeat || isTypingTarget(event.target)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key.toLowerCase() !== 'l') return
      event.preventDefault()
      setIsCanvasLocked((prev) => !prev)
      setMenuState(null)
    }
    window.addEventListener('keydown', handleLockShortcut)
    return () => window.removeEventListener('keydown', handleLockShortcut)
  }, [])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('curate:toolbar-state', {
      detail: { isCommentMode, isCanvasLocked, isClusterMode },
    }))
  }, [isCommentMode, isCanvasLocked, isClusterMode])

  useEffect(() => {
    function handleToolbarAction(event) {
      const action = event.detail?.action
      if (action === 'toggle-comment') {
        handleToggleCommentMode()
        return
      }
      if (action === 'toggle-lock') {
        handleToggleCanvasLock()
        return
      }
      if (action === 'toggle-cluster') {
        setIsClusterMode((prev) => !prev)
        return
      }
      if (action === 'reset-view') {
        handleResetView()
      }
    }
    window.addEventListener('curate:toolbar-action', handleToolbarAction)
    return () => window.removeEventListener('curate:toolbar-action', handleToolbarAction)
  }, [isCommentMode, isCanvasLocked, isClusterMode, offsetX, offsetY, scale, images])

  useEffect(() => {
    function handleDelete(event) {
      if (selectedImageIds.length === 0) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (isTypingTarget(event.target)) return
      if (!canTransform) {
        event.preventDefault()
        showLockBlockedFeedback()
        return
      }
      event.preventDefault()
      const prevImages = imagesRef.current
      const prevSelected = selectedIdsRef.current
      const imagesToDelete = prevImages.filter((image) => selectedImageIds.includes(image.id))
      setImages((prev) => prev.filter((image) => !selectedImageIds.includes(image.id)))
      setSelectedImageIds([])
      setMenuState(null)
      commitHistory(prevImages, prevSelected)
      void Promise.all(
        imagesToDelete.map((image) => deleteImageBlobById(image.id)),
      ).catch(() => {
        // Ignore blob cleanup failure; metadata removal is already complete.
      })
    }
    window.addEventListener('keydown', handleDelete)
    return () => window.removeEventListener('keydown', handleDelete)
  }, [canTransform, selectedImageIds])

  useEffect(() => {
    if (!isCanvasLocked) return
    if (!dragState && !clusterDragState && !clusterDrawState && !resizeState && !panState && !marqueeState && !cropInteraction && !quickCropState && !cropMode) return
    setDragState(null)
    setClusterDragState(null)
    setClusterDrawState(null)
    setResizeState(null)
    setPanState(null)
    setMarqueeState(null)
    setCropInteraction(null)
    setQuickCropState(null)
    setCropMode(null)
    setSmartGuides({ vertical: null, horizontal: null })
  }, [isCanvasLocked, dragState, clusterDragState, clusterDrawState, resizeState, panState, marqueeState, cropInteraction, quickCropState, cropMode])

  useEffect(() => {
    if (!isCanvasLocked) return
    setEditingClusterId(null)
    setEditingTitle('')
    setOpenClusterMenuId(null)
  }, [isCanvasLocked])

  useEffect(() => {
    function handleKeyActions(event) {
      if (event.repeat || isTypingTarget(event.target)) return
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'c') {
        if (selectedImageIds.length === 0) return
        event.preventDefault()
        const selected = images.filter((image) => selectedImageIds.includes(image.id))
        const minX = Math.min(...selected.map((image) => image.x))
        const minY = Math.min(...selected.map((image) => image.y))
        setInternalClipboard({
          items: selected.map((image) => {
            const size = getImageSize(image)
            return { src: image.src, relX: image.x - minX, relY: image.y - minY, width: size.width, height: size.height }
          }),
        })
        return
      }
      if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (key === 'y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handleKeyActions)
    return () => window.removeEventListener('keydown', handleKeyActions)
  }, [selectedImageIds, images])

  useEffect(() => {
    function handleCropShortcuts(event) {
      if (isTypingTarget(event.target)) return
      if (event.key === 'Escape' && cropMode) {
        event.preventDefault()
        cancelCropMode()
        return
      }
      if (event.key === 'Enter' && cropMode) {
        event.preventDefault()
        void confirmCropMode()
        return
      }
    }
    window.addEventListener('keydown', handleCropShortcuts)
    return () => window.removeEventListener('keydown', handleCropShortcuts)
  }, [cropMode])

  function getViewportCenterPoint() {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { x: (rect.width / 2 - offsetX) / scale, y: (rect.height / 2 - offsetY) / scale }
  }

async function createImagesFromFiles(files, baseX, baseY) {
  const localImages = await Promise.all(
    files.map(async (file) => {
      const imageId = nanoid()
      const processedBlob = await processImage(file)
      const [src, dimensions] = await Promise.all([
        saveBlobForImage(imageId, processedBlob),
        getImageDimensionsFromFile(
          new File([processedBlob], `optimized-${imageId}`, { type: processedBlob.type || file.type || 'image/webp' }),
        ),
      ])
      return { id: imageId, src, dimensions }
    }),
  )
    const nextClusters = clustersRef.current
    return localImages.map(({ id, src, dimensions }, index) => {
      const fitted = fitWithinMax(dimensions.width, dimensions.height)
      const image = makeImageItem(src, baseX + index * IMAGE_SPACING, baseY + index * IMAGE_SPACING, fitted.width, fitted.height)
      const withId = { ...image, id }
      return { ...withId, clusterId: assignClusterIdToImage(withId, nextClusters) }
    })
  }

  async function pasteFilesFromClipboard(files) {
    if (!canTransform) {
      showLockBlockedFeedback()
      return false
    }
    if (files.length === 0) return false
    const center = getViewportCenterPoint()
    if (!center) return false
    const offset = pasteCount * PASTE_OFFSET_STEP
    let newImages = []
    try {
      newImages = await createImagesFromFiles(files, center.x + offset, center.y + offset)
    } catch {
      setPasteFeedback('Failed to insert image')
      return false
    }
    if (newImages.length === 0) {
      setPasteFeedback('Failed to insert image')
      return false
    }
    const prevImages = imagesRef.current
    const prevSelected = selectedIdsRef.current
    setImages((prev) => [...prev, ...newImages])
    setSelectedImageIds(newImages.map((image) => image.id))
    setPasteCount((prev) => prev + 1)
    setMenuState(null)
    commitHistory(prevImages, prevSelected)
    return true
  }

  function pasteFromInternalClipboard() {
    if (!canTransform) {
      showLockBlockedFeedback()
      return false
    }
    const center = getViewportCenterPoint()
    if (!center || !internalClipboard?.items?.length) return false
    const offset = pasteCount * PASTE_OFFSET_STEP
    const items = internalClipboard.items
    const maxRight = Math.max(...items.map((item) => item.relX + item.width))
    const maxBottom = Math.max(...items.map((item) => item.relY + item.height))
    const startX = center.x - maxRight / 2 + offset
    const startY = center.y - maxBottom / 2 + offset
    const nextClusters = clustersRef.current
    const pasted = items.map((item) => {
      const image = makeImageItem(item.src, startX + item.relX, startY + item.relY, item.width, item.height)
      return { ...image, clusterId: assignClusterIdToImage(image, nextClusters) }
    })
    const prevImages = imagesRef.current
    const prevSelected = selectedIdsRef.current
    setImages((prev) => [...prev, ...pasted])
    setSelectedImageIds(pasted.map((image) => image.id))
    setPasteCount((prev) => prev + 1)
    setMenuState(null)
    commitHistory(prevImages, prevSelected)
    return true
  }

  useEffect(() => {
    async function handlePaste(event) {
      if (isTypingTarget(event.target)) return
      const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'))
      if (files.length > 0) {
        event.preventDefault()
        await pasteFilesFromClipboard(files)
        return
      }
      if (internalClipboard?.items?.length) {
        event.preventDefault()
        pasteFromInternalClipboard()
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [internalClipboard, pasteCount, offsetX, offsetY, scale])

  async function getSystemClipboardImage() {
    if (!window.isSecureContext || !navigator.clipboard?.read) {
      return { status: 'unsupported', image: null }
    }
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith('image/'))
        if (!imageType) continue
        const blob = await item.getType(imageType)
        const file = new File([blob], `clipboard-${crypto.randomUUID()}`, { type: blob.type || imageType })
        const imageId = nanoid()
        const processedBlob = await processImage(file)
        const [src, dimensions] = await Promise.all([
          saveBlobForImage(imageId, processedBlob),
          getImageDimensionsFromFile(
            new File([processedBlob], `optimized-${imageId}`, { type: processedBlob.type || file.type || 'image/webp' }),
          ),
        ])
        const fitted = fitWithinMax(dimensions.width, dimensions.height)
        return { status: 'image', image: { id: imageId, src, width: fitted.width, height: fitted.height } }
      }
    } catch {
      return { status: 'denied', image: null }
    }
    return { status: 'empty', image: null }
  }

  async function checkPasteAvailabilityOnMenuOpen() {
    const hasInternal = Boolean(internalClipboard?.items?.length)
    setIsPasteAvailable(hasInternal)
    if (!window.isSecureContext || !navigator.clipboard?.read) return
    try {
      const items = await navigator.clipboard.read()
      const hasSupportedImage = items.some((item) =>
        item.types.some((type) => PASTE_IMAGE_MIME_TYPES.has(type)),
      )
      setIsPasteAvailable(hasInternal || hasSupportedImage)
    } catch {
      // Permission denied or unavailable clipboard API. Keep internal availability only.
      setIsPasteAvailable(hasInternal)
    }
  }

  async function pasteFromClipboard() {
    if (!canTransform) {
      showLockBlockedFeedback()
      return 'locked'
    }
    const center = getViewportCenterPoint()
    if (!center) return 'empty'
    const clipboardResult = await getSystemClipboardImage()
    if (clipboardResult.status === 'image' && clipboardResult.image) {
      const systemImage = clipboardResult.image
      const offset = pasteCount * PASTE_OFFSET_STEP
      const pastedImage = makeImageItem(
        systemImage.src,
        center.x - systemImage.width / 2 + offset,
        center.y - systemImage.height / 2 + offset,
        systemImage.width,
        systemImage.height,
      )
      pastedImage.id = systemImage.id
      pastedImage.clusterId = assignClusterIdToImage(pastedImage, clustersRef.current)
      const prevImages = imagesRef.current
      const prevSelected = selectedIdsRef.current
      setImages((prev) => [...prev, pastedImage])
      setSelectedImageIds([pastedImage.id])
      setPasteCount((prev) => prev + 1)
      setMenuState(null)
      commitHistory(prevImages, prevSelected)
      return 'pasted'
    }
    if (pasteFromInternalClipboard()) return 'pasted'
    if (clipboardResult.status === 'denied') return 'denied'
    if (clipboardResult.status === 'unsupported') return 'unsupported'
    return 'empty'
  }

  useEffect(() => {
    if (!dragState && !clusterDragState && !clusterDrawState && !commentDragState && !panState && !resizeState && !marqueeState && !cropInteraction && !quickCropState) return
    function handleMouseMove(event) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      if (cropInteraction && cropMode) {
        const image = imagesRef.current.find((item) => item.id === cropMode.id)
        if (!image) return
        const bounds = getImageBounds(image)
        const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetXRef.current, offsetYRef.current, scaleRef.current)
        const dx = pointer.x - cropInteraction.startPointerX
        const dy = pointer.y - cropInteraction.startPointerY
        const startRect = cropInteraction.startRect

        if (cropInteraction.type === 'move') {
          const nextX = clamp(startRect.x + dx, bounds.left, bounds.right - startRect.width)
          const nextY = clamp(startRect.y + dy, bounds.top, bounds.bottom - startRect.height)
          setCropMode((prev) => (prev ? { ...prev, rect: { ...prev.rect, x: nextX, y: nextY } } : prev))
          return
        }

        const handle = cropInteraction.handle
        let left = startRect.x
        let right = startRect.x + startRect.width
        let top = startRect.y
        let bottom = startRect.y + startRect.height

        if (handle.includes('w')) left += dx
        if (handle.includes('e')) right += dx
        if (handle.includes('n')) top += dy
        if (handle.includes('s')) bottom += dy

        left = clamp(left, bounds.left, bounds.right)
        right = clamp(right, bounds.left, bounds.right)
        top = clamp(top, bounds.top, bounds.bottom)
        bottom = clamp(bottom, bounds.top, bounds.bottom)

        if (right - left < MIN_CROP_RECT_SIZE) {
          if (handle.includes('w')) left = right - MIN_CROP_RECT_SIZE
          else right = left + MIN_CROP_RECT_SIZE
        }
        if (bottom - top < MIN_CROP_RECT_SIZE) {
          if (handle.includes('n')) top = bottom - MIN_CROP_RECT_SIZE
          else bottom = top + MIN_CROP_RECT_SIZE
        }

        left = clamp(left, bounds.left, bounds.right - MIN_CROP_RECT_SIZE)
        top = clamp(top, bounds.top, bounds.bottom - MIN_CROP_RECT_SIZE)
        right = clamp(right, left + MIN_CROP_RECT_SIZE, bounds.right)
        bottom = clamp(bottom, top + MIN_CROP_RECT_SIZE, bounds.bottom)

        setCropMode((prev) =>
          prev
            ? { ...prev, rect: { x: left, y: top, width: right - left, height: bottom - top } }
            : prev,
        )
        return
      }

      if (quickCropState) {
        const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetXRef.current, offsetYRef.current, scaleRef.current)
        setQuickCropState((prev) =>
          prev ? { ...prev, currentX: pointer.x, currentY: pointer.y } : prev,
        )
        return
      }

      if (clusterDrawState) {
        const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetXRef.current, offsetYRef.current, scaleRef.current)
        setClusterDrawState((prev) => (prev ? { ...prev, currentX: pointer.x, currentY: pointer.y } : prev))
        return
      }

      if (clusterDragState) {
        const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetXRef.current, offsetYRef.current, scaleRef.current)
        const dx = pointer.x - clusterDragState.startPointerX
        const dy = pointer.y - clusterDragState.startPointerY
        setClusters((prev) =>
          prev.map((cluster) =>
            cluster.id === clusterDragState.clusterId
              ? {
                  ...cluster,
                  bounds: {
                    x: clusterDragState.startClusterX + dx,
                    y: clusterDragState.startClusterY + dy,
                    width: getBoundsFromCluster(cluster).width,
                    height: getBoundsFromCluster(cluster).height,
                  },
                  x: clusterDragState.startClusterX + dx,
                  y: clusterDragState.startClusterY + dy,
                  updatedAt: Date.now(),
                }
              : cluster,
          ),
        )
        setImages((prev) =>
          prev.map((image) => {
            const start = clusterDragState.childStartPositions[image.id]
            if (!start) return image
            return { ...image, x: start.x + dx, y: start.y + dy }
          }),
        )
        return
      }

      if (resizeState) {
        const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetXRef.current, offsetYRef.current, scaleRef.current)
        const handle = resizeState.handle
        const start = resizeState.startRect
        const aspect = Math.max(0.0001, resizeState.aspectRatio || start.width / Math.max(start.height, 0.0001))
        const isCorner = (handle.includes('w') || handle.includes('e')) && (handle.includes('n') || handle.includes('s'))
        const anchorX = handle.includes('w') ? start.x + start.width : handle.includes('e') ? start.x : start.x + start.width / 2
        const anchorY = handle.includes('n') ? start.y + start.height : handle.includes('s') ? start.y : start.y + start.height / 2

        let width = start.width
        let height = start.height

        if (isCorner) {
          const rawW = Math.max(MIN_IMAGE_SIZE, Math.abs(pointer.x - anchorX))
          const rawH = Math.max(MIN_IMAGE_SIZE, Math.abs(pointer.y - anchorY))
          const sizeFromW = rawW
          const sizeFromH = rawH * aspect
          width = Math.max(sizeFromW, sizeFromH, MIN_IMAGE_SIZE)
          height = Math.max(MIN_IMAGE_SIZE, width / aspect)
        } else if (handle === 'n' || handle === 's') {
          height = Math.max(MIN_IMAGE_SIZE, Math.abs(pointer.y - anchorY))
          width = Math.max(MIN_IMAGE_SIZE, height * aspect)
        } else if (handle === 'e' || handle === 'w') {
          width = Math.max(MIN_IMAGE_SIZE, Math.abs(pointer.x - anchorX))
          height = Math.max(MIN_IMAGE_SIZE, width / aspect)
        }

        const x = handle.includes('w')
          ? anchorX - width
          : handle.includes('e')
            ? anchorX
            : anchorX - width / 2
        const y = handle.includes('n')
          ? anchorY - height
          : handle.includes('s')
            ? anchorY
            : anchorY - height / 2

        setImages((prev) =>
          prev.map((image) =>
            image.id === resizeState.id
              ? { ...image, x, y, width, height }
              : image,
          ),
        )
        return
      }

      if (dragState) {
        const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetX, offsetY, scale)
        let dx = pointer.x - dragState.startPointerX
        let dy = pointer.y - dragState.startPointerY
        if (isSnappingEnabled || isImageSnappingEnabled) {
          const primaryStart = dragState.initialPositions[dragState.primaryId]
          if (primaryStart) {
            let smartSnap = null
            if (isImageSnappingEnabled) {
              smartSnap = getSmartSnapResult(images, dragState, dx, dy)
              dx = smartSnap.dx
              dy = smartSnap.dy
              setSmartGuides(smartSnap.guides)
            } else {
              setSmartGuides((prev) => (prev.vertical || prev.horizontal ? { vertical: null, horizontal: null } : prev))
            }

            if (isSnappingEnabled && (!smartSnap || !smartSnap.guides.vertical)) {
              const rawX = primaryStart.x + dx
              const snappedX = snapToGrid(rawX, GRID_SIZE)
              dx = snappedX - primaryStart.x
            }
            if (isSnappingEnabled && (!smartSnap || !smartSnap.guides.horizontal)) {
              const rawY = primaryStart.y + dy
              const snappedY = snapToGrid(rawY, GRID_SIZE)
              dy = snappedY - primaryStart.y
            }
          }
        } else {
          setSmartGuides((prev) => (prev.vertical || prev.horizontal ? { vertical: null, horizontal: null } : prev))
        }
        const movedIds = new Set(dragState.draggedIds)
        const nextClusters = clustersRef.current
        setImages((prev) =>
          prev.map((image) => {
            if (!movedIds.has(image.id)) return image
            const start = dragState.initialAllPositions[image.id]
            if (!start) return image
            const nextX = start.x + dx
            const nextY = start.y + dy
            const size = getImageSize(image)
            const nextClusterId = getClusterIdByContainment(
              getBoundsFromImage(image, nextX, nextY, size.width, size.height),
              nextClusters,
              image.clusterId ?? null,
            )
            return { ...image, x: nextX, y: nextY, clusterId: nextClusterId }
          }),
        )
        return
      }

      if (commentDragState) {
        const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetXRef.current, offsetYRef.current, scaleRef.current)
        const dx = pointer.x - commentDragState.startPointerX
        const dy = pointer.y - commentDragState.startPointerY
        const nextWorldX = commentDragState.startX + dx
        const nextWorldY = commentDragState.startY + dy
        const parent = commentDragState.parentId
          ? imagesRef.current.find((image) => image.id === commentDragState.parentId)
          : null
        const nextPosition = parent
          ? { x: nextWorldX - parent.x, y: nextWorldY - parent.y }
          : { x: nextWorldX, y: nextWorldY }
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          suppressCommentPinClickRef.current = true
        }
        setComments((prev) =>
          prev.map((comment) =>
            comment.id === commentDragState.commentId
              ? {
                  ...comment,
                  position: nextPosition,
                }
              : comment,
          ),
        )
        return
      }

      if (panState) {
        const nextOffsetX = panState.startOffsetX + (event.clientX - panState.startClientX)
        const nextOffsetY = panState.startOffsetY + (event.clientY - panState.startClientY)
        setOffsetX(nextOffsetX)
        setOffsetY(nextOffsetY)
        return
      }

      if (marqueeState) {
        setMarqueeState((prev) =>
          prev ? { ...prev, currentClientX: event.clientX, currentClientY: event.clientY } : prev,
        )
      }
    }

    function handleMouseUp() {
      if (clusterDrawState) {
        const state = clusterDrawState
        setClusterDrawState(null)
        const left = Math.min(state.startX, state.currentX)
        const top = Math.min(state.startY, state.currentY)
        const width = Math.abs(state.currentX - state.startX)
        const height = Math.abs(state.currentY - state.startY)
        if (width >= MIN_CLUSTER_SIZE && height >= MIN_CLUSTER_SIZE) {
          try {
            const clusterId = crypto.randomUUID()
            const drawBounds = { x: left, y: top, width, height }
            const isNested = clustersRef.current.some((cluster) => {
              const bounds = getBoundsFromCluster(cluster)
              return (
                drawBounds.x >= bounds.left &&
                drawBounds.y >= bounds.top &&
                drawBounds.x + drawBounds.width <= bounds.right &&
                drawBounds.y + drawBounds.height <= bounds.bottom
              )
            })
            if (isNested) {
              return
            }
            const newName = getNextClusterName(clustersRef.current)
            const now = Date.now()
            const nextCluster = {
              id: clusterId,
              name: newName,
              title: newName,
              itemIds: [],
              bounds: drawBounds,
              x: drawBounds.x,
              y: drawBounds.y,
              width: drawBounds.width,
              height: drawBounds.height,
              createdAt: now,
              updatedAt: now,
            }
            const nextClusters = [...clustersRef.current, nextCluster]
            const nextClusterBounds = getBoundsFromCluster(nextCluster)
            let assignedCount = 0
            const nextImages = imagesRef.current.map((image) => {
              const size = getImageSize(image)
              const bounds = getBoundsFromImage(image, image.x, image.y, size.width, size.height)
              const intersectsNewCluster = getIntersectionArea(bounds, nextClusterBounds) > 0
              if (!intersectsNewCluster) return image
              assignedCount += 1
              if (image.clusterId === clusterId) return image
              return { ...image, clusterId: clusterId }
            })
            if (assignedCount === 0) return
            const syncedClusters = syncClusterItems(nextClusters, nextImages).map((cluster) =>
              cluster.id === clusterId ? { ...cluster, updatedAt: Date.now() } : cluster,
            )
            setClusters(syncedClusters)
            setImages(nextImages)
            setSelectedClusterId(clusterId)
          } catch {
            // Fail-safe: keep default interaction if cluster creation fails.
          }
        }
        if (hasSnapshotChanged(state.historySnapshot)) {
          commitHistory(
            state.historySnapshot.images,
            state.historySnapshot.selectedImageIds,
            state.historySnapshot.comments,
            state.historySnapshot.clusters,
          )
        }
        return
      }

      if (clusterDragState) {
        const state = clusterDragState
        if (hasSnapshotChanged(state.historySnapshot)) {
          commitHistory(
            state.historySnapshot.images,
            state.historySnapshot.selectedImageIds,
            state.historySnapshot.comments,
            state.historySnapshot.clusters,
          )
        }
        setClusterDragState(null)
        return
      }

      if (quickCropState) {
        const state = quickCropState
        setQuickCropState(null)
        const left = Math.min(state.startX, state.currentX)
        const top = Math.min(state.startY, state.currentY)
        const width = Math.abs(state.currentX - state.startX)
        const height = Math.abs(state.currentY - state.startY)
        if (width > 1 && height > 1) {
          const cropRect = { left, right: left + width, top, bottom: top + height }
          const topMostIntersecting = [...imagesRef.current].reverse().find((image) => intersects(cropRect, image))
          if (topMostIntersecting) {
            void applyCropByRectRef.current?.(topMostIntersecting.id, { x: left, y: top, width, height }, state.historySnapshot)
          }
        }
        return
      }

      if (cropInteraction) {
        setCropInteraction(null)
        return
      }

      if (marqueeState) {
        const rect = canvasRef.current?.getBoundingClientRect()
        if (rect) {
          const left = Math.min(marqueeState.startClientX, marqueeState.currentClientX)
          const right = Math.max(marqueeState.startClientX, marqueeState.currentClientX)
          const top = Math.min(marqueeState.startClientY, marqueeState.currentClientY)
          const bottom = Math.max(marqueeState.startClientY, marqueeState.currentClientY)
          const isClick =
            Math.abs(marqueeState.currentClientX - marqueeState.startClientX) < MARQUEE_CLICK_THRESHOLD &&
            Math.abs(marqueeState.currentClientY - marqueeState.startClientY) < MARQUEE_CLICK_THRESHOLD
          if (isClick) {
            if (!marqueeState.appendToSelection) setSelectedImageIds([])
          } else {
            const topLeft = toCanvasPoint(left, top, rect, offsetX, offsetY, scale)
            const bottomRight = toCanvasPoint(right, bottom, rect, offsetX, offsetY, scale)
            const selectionRect = { left: topLeft.x, right: bottomRight.x, top: topLeft.y, bottom: bottomRight.y }
            const intersected = images.filter((image) => intersects(selectionRect, image)).map((image) => image.id)
            setSelectedImageIds((prev) =>
              marqueeState.appendToSelection ? Array.from(new Set([...prev, ...intersected])) : intersected,
            )
          }
        }
      }
      if (hasSnapshotChanged(dragState?.historySnapshot)) {
        commitHistory(dragState.historySnapshot.images, dragState.historySnapshot.selectedImageIds)
      }
      if (hasSnapshotChanged(resizeState?.historySnapshot)) {
        commitHistory(resizeState.historySnapshot.images, resizeState.historySnapshot.selectedImageIds)
      }
      if (commentDragState && hasSnapshotChanged(commentDragState.historySnapshot)) {
        commitHistory(
          commentDragState.historySnapshot.images,
          commentDragState.historySnapshot.selectedImageIds,
          commentDragState.historySnapshot.comments,
          commentDragState.historySnapshot.clusters,
        )
      }
      setDragState(null)
      setClusterDragState(null)
      setClusterDrawState(null)
      setCommentDragState(null)
      setSmartGuides({ vertical: null, horizontal: null })
      setPanState(null)
      setResizeState(null)
      setMarqueeState(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragState, clusterDragState, clusterDrawState, commentDragState, panState, resizeState, marqueeState, cropInteraction, cropMode, quickCropState, scale, offsetX, offsetY, images, isSnappingEnabled, isImageSnappingEnabled, isCommentMode, isCanvasLocked])

  function handleDragOver(event) {
    if (quickCropState) return
    event.preventDefault()
  }

  async function handleDrop(event) {
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    if (quickCropState) return
    event.preventDefault()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const point = toCanvasPoint(event.clientX, event.clientY, rect, offsetX, offsetY, scale)

    // 1) Existing file-drop flow
    const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'))
    let newImages = []
    if (files.length > 0) {
      try {
        newImages = await createImagesFromFiles(files, point.x, point.y)
      } catch {
        setPasteFeedback('Failed to insert image')
        return
      }
    } else {
      // 2) URL-drop flow (e.g. websites that expose image URI via text/uri-list)
      const uriList = event.dataTransfer.getData('text/uri-list')
      const droppedUrl = uriList
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith('#'))

      if (!droppedUrl) return

      try {
        const response = await fetch(droppedUrl)
        if (!response.ok) throw new Error('Failed to fetch dropped URL')
        const blob = await response.blob()
        if (!blob.type.startsWith('image/')) throw new Error('Dropped URL is not an image')
        const file = new File([blob], `drop-${crypto.randomUUID()}`, { type: blob.type })
        const imageId = nanoid()
        const processedBlob = await processImage(file)
        const [src, dimensions] = await Promise.all([
          saveBlobForImage(imageId, processedBlob),
          getImageDimensionsFromFile(
            new File([processedBlob], `optimized-${imageId}`, { type: processedBlob.type || file.type || 'image/webp' }),
          ),
        ])
        const fitted = fitWithinMax(dimensions.width, dimensions.height)
        const image = makeImageItem(src, point.x, point.y, fitted.width, fitted.height)
        image.id = imageId
        image.clusterId = assignClusterIdToImage(image, clustersRef.current)
        newImages = [image]
      } catch {
        setPasteFeedback('This image cannot be dropped')
        return
      }
    }

    if (newImages.length === 0) return
    const prevImages = imagesRef.current
    const prevSelected = selectedIdsRef.current
    setImages((prev) => [...prev, ...newImages])
    setSelectedImageIds(newImages.map((image) => image.id))
    commitHistory(prevImages, prevSelected)
  }

  function handleImageMouseDown(event, image) {
    if (cropMode) return
    if (isCommentMode) return

    if (event.button === 1) {
      if (cropMode) return
      if (!canPan) {
        showLockBlockedFeedback()
        return
      }
      event.preventDefault()
      event.stopPropagation()
      setPanState({
        startClientX: event.clientX,
        startClientY: event.clientY,
        startOffsetX: offsetX,
        startOffsetY: offsetY,
      })
      return
    }
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    setMenuState(null)
    setOpenClusterMenuId(null)
    setSelectedClusterId(null)
    if (!canTransform) {
      if (!selectedImageIds.includes(image.id)) setSelectedImageIds([image.id])
      showLockBlockedFeedback()
      return
    }
    if (isQuickCropKeyDown) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetX, offsetY, scale)
      setQuickCropState({
        startX: pointer.x,
        startY: pointer.y,
        currentX: pointer.x,
        currentY: pointer.y,
        historySnapshot: { images: imagesRef.current, selectedImageIds: selectedIdsRef.current },
      })
      setPanState(null)
      return
    }
    if (isSpaceDown) {
      if (!canPan) {
        showLockBlockedFeedback()
        return
      }
      setPanState({
        startClientX: event.clientX,
        startClientY: event.clientY,
        startOffsetX: offsetX,
        startOffsetY: offsetY,
      })
      return
    }
    if (event.shiftKey) {
      setSelectedImageIds((prev) => (prev.includes(image.id) ? prev.filter((id) => id !== image.id) : [...prev, image.id]))
      return
    }
    const isAlreadySelected = selectedImageIds.includes(image.id)
    const draggedIds = isAlreadySelected ? selectedImageIds : [image.id]
    if (!isAlreadySelected) setSelectedImageIds([image.id])
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetX, offsetY, scale)
    const initialPositions = {}
    const initialAllPositions = {}
    for (const currentImage of images) {
      initialAllPositions[currentImage.id] = { x: currentImage.x, y: currentImage.y }
      if (draggedIds.includes(currentImage.id)) initialPositions[currentImage.id] = { x: currentImage.x, y: currentImage.y }
    }
    setDragState({
      primaryId: image.id,
      draggedIds,
      startPointerX: pointer.x,
      startPointerY: pointer.y,
      initialPositions,
      initialAllPositions,
      historySnapshot: { images: imagesRef.current, selectedImageIds: selectedIdsRef.current },
    })
  }

  function handleClusterMouseDown(event, cluster) {
    if (event.button !== 0) return
    if (!canTransform || isCommentMode || resizeState || cropMode || quickCropState) return
    event.preventDefault()
    event.stopPropagation()
    setSelectedClusterId(cluster.id)
    setOpenClusterMenuId(null)
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetX, offsetY, scale)
    const childStartPositions = {}
    for (const image of imagesRef.current) {
      if (image.clusterId !== cluster.id) continue
      childStartPositions[image.id] = { x: image.x, y: image.y }
    }
    const bounds = getBoundsFromCluster(cluster)
    setClusterDragState({
      clusterId: cluster.id,
      startPointerX: pointer.x,
      startPointerY: pointer.y,
      startClusterX: bounds.left,
      startClusterY: bounds.top,
      childStartPositions,
      historySnapshot: {
        images: imagesRef.current,
        comments: commentsRef.current,
        clusters: clustersRef.current,
        selectedImageIds: selectedIdsRef.current,
      },
    })
  }

  function handleStartClusterTitleEdit(event, cluster) {
    event.preventDefault()
    event.stopPropagation()
    if (isCanvasLocked) return
    const nextTitle = typeof cluster.name === 'string' && cluster.name.trim() ? cluster.name.trim().slice(0, 80) : getNextClusterName(clustersRef.current)
    setEditingClusterId(cluster.id)
    setEditingTitle(nextTitle)
    setOpenClusterMenuId(null)
  }

  function cancelClusterTitleEdit() {
    setEditingClusterId(null)
    setEditingTitle('')
  }

  function saveClusterTitleEdit(clusterId, rawTitle) {
    if (!clusterId) return
    const previousClusters = clustersRef.current
    const targetCluster = previousClusters.find((cluster) => cluster.id === clusterId)
    if (!targetCluster) {
      cancelClusterTitleEdit()
      return
    }
    const normalizedTitle = (typeof rawTitle === 'string' ? rawTitle.trim() : '').slice(0, 80) || targetCluster.name || 'Cluster'
    const currentTitle = typeof targetCluster.name === 'string' && targetCluster.name.trim() ? targetCluster.name.trim() : 'Cluster'
    if (normalizedTitle === currentTitle) {
      cancelClusterTitleEdit()
      return
    }
    const previousImages = imagesRef.current
    const previousSelected = selectedIdsRef.current
    const previousComments = commentsRef.current
    try {
      setClusters((prev) =>
        prev.map((cluster) =>
          cluster.id === clusterId
            ? { ...cluster, name: normalizedTitle, title: normalizedTitle, updatedAt: Date.now() }
            : cluster,
        ),
      )
      commitHistory(previousImages, previousSelected, previousComments, previousClusters)
    } catch {
      setClusters(previousClusters)
    } finally {
      cancelClusterTitleEdit()
    }
  }

  function handleClusterTitleInputBlur() {
    if (skipClusterTitleBlurRef.current) {
      skipClusterTitleBlurRef.current = false
      return
    }
    if (!editingClusterId) return
    saveClusterTitleEdit(editingClusterId, editingTitle)
  }

  function handleClusterTitleInputKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      if (!editingClusterId) return
      saveClusterTitleEdit(editingClusterId, editingTitle)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      skipClusterTitleBlurRef.current = true
      cancelClusterTitleEdit()
    }
  }

  function handleToggleClusterMenu(event, clusterId) {
    event.preventDefault()
    event.stopPropagation()
    if (isCanvasLocked) return
    setSelectedClusterId(clusterId)
    setOpenClusterMenuId((prev) => (prev === clusterId ? null : clusterId))
  }

  function handleUngroupCluster(event, clusterId) {
    event.preventDefault()
    event.stopPropagation()
    const prevImages = imagesRef.current
    const prevSelected = selectedIdsRef.current
    const prevComments = commentsRef.current
    const prevClusters = clustersRef.current
    setImages((prev) =>
      prev.map((image) => (image.clusterId === clusterId ? { ...image, clusterId: null } : image)),
    )
    setClusters((prev) => prev.filter((cluster) => cluster.id !== clusterId))
    setSelectedClusterId((prev) => (prev === clusterId ? null : prev))
    setOpenClusterMenuId(null)
    cancelClusterTitleEdit()
    commitHistory(prevImages, prevSelected, prevComments, prevClusters)
  }

  function handleResizeHandleMouseDown(event, image, handle) {
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    setMenuState(null)
    setSelectedImageIds([image.id])
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetX, offsetY, scale)
    const renderedBounds = getRenderedImageBounds(image, imageNaturalSizes[image.id])
    setResizeState({
      id: image.id,
      handle,
      startPointerX: pointer.x,
      startPointerY: pointer.y,
      startRect: renderedBounds,
      aspectRatio: Math.max(0.0001, renderedBounds.width / Math.max(renderedBounds.height, 0.0001)),
      historySnapshot: { images: imagesRef.current, selectedImageIds: selectedIdsRef.current },
    })
  }

  function beginCropInteraction(event, type, handle = null) {
    if (!cropMode) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetX, offsetY, scale)
    event.preventDefault()
    event.stopPropagation()
    setCropInteraction({
      type,
      handle,
      startPointerX: pointer.x,
      startPointerY: pointer.y,
      startRect: { ...cropMode.rect },
    })
  }

  function handleCropFrameMouseDown(event) {
    beginCropInteraction(event, 'move')
  }

  function handleCropHandleMouseDown(event, handle) {
    beginCropInteraction(event, 'resize', handle)
  }

  function handleCanvasMouseDown(event) {
    setMenuState(null)
    setOpenClusterMenuId(null)
    setSelectedClusterId(null)
    if (activeCommentRef) {
      closeCommentEditorFromOutside()
    }
    if (cropMode) {
      const rect = canvasRef.current?.getBoundingClientRect()
      const image = imagesRef.current.find((item) => item.id === cropMode.id)
      if (!rect || !image) return
      const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetX, offsetY, scale)
      const cropRect = cropMode.rect
      const imageBounds = getImageBounds(image)
      const isInsideCropRect =
        pointer.x >= cropRect.x &&
        pointer.x <= cropRect.x + cropRect.width &&
        pointer.y >= cropRect.y &&
        pointer.y <= cropRect.y + cropRect.height
      const isInsideImage =
        pointer.x >= imageBounds.left &&
        pointer.x <= imageBounds.right &&
        pointer.y >= imageBounds.top &&
        pointer.y <= imageBounds.bottom
      if (!isInsideCropRect && !isInsideImage) {
        cancelCropMode()
      }
      return
    }
    if (quickCropState) return
    if (event.button === 0 && isCommentMode) {
      if (!canComment) return
      event.preventDefault()
      return
    }
    if (event.button === 0 && isQuickCropKeyDown) {
      if (!canTransform) {
        showLockBlockedFeedback()
        return
      }
      event.preventDefault()
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetX, offsetY, scale)
      setQuickCropState({
        startX: pointer.x,
        startY: pointer.y,
        currentX: pointer.x,
        currentY: pointer.y,
        historySnapshot: { images: imagesRef.current, selectedImageIds: selectedIdsRef.current },
      })
      setPanState(null)
      return
    }
    if (event.button === 1) {
      if (!canPan) {
        showLockBlockedFeedback()
        return
      }
      event.preventDefault()
      setPanState({
        startClientX: event.clientX,
        startClientY: event.clientY,
        startOffsetX: offsetX,
        startOffsetY: offsetY,
      })
      return
    }
    if (event.button === 0 && isSpaceDown) {
      if (!canPan) {
        showLockBlockedFeedback()
        return
      }
      setPanState({
        startClientX: event.clientX,
        startClientY: event.clientY,
        startOffsetX: offsetX,
        startOffsetY: offsetY,
      })
      return
    }
    if (event.button === 0 && isClusterMode) {
      const isTransforming = Boolean(resizeState)
      const isCropping = Boolean(cropMode)
      const isQuickCropping = Boolean(quickCropState)
      if (isCanvasLocked || isCommentMode || isTransforming || isCropping || isQuickCropping) return
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      event.preventDefault()
      const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetX, offsetY, scale)
      const isInsideExistingCluster = clustersRef.current.some((cluster) => {
        const bounds = getBoundsFromCluster(cluster)
        return pointer.x >= bounds.left && pointer.x <= bounds.right && pointer.y >= bounds.top && pointer.y <= bounds.bottom
      })
      if (isInsideExistingCluster) return
      setClusterDrawState({
        startX: pointer.x,
        startY: pointer.y,
        currentX: pointer.x,
        currentY: pointer.y,
        historySnapshot: {
          images: imagesRef.current,
          comments: commentsRef.current,
          clusters: clustersRef.current,
          selectedImageIds: selectedIdsRef.current,
        },
      })
      return
    }
    if (event.button === 0) {
      setMarqueeState({
        startClientX: event.clientX,
        startClientY: event.clientY,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
        appendToSelection: event.shiftKey,
      })
    }
  }

  function handleCanvasClick(event) {
    if (!isCommentMode || !canComment || event.button !== 0) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetXRef.current, offsetYRef.current, scaleRef.current)
    const imageElement = event.target instanceof Element ? event.target.closest('[data-image-id]') : null
    const parentId = imageElement ? imageElement.getAttribute('data-image-id') : null
    handlePlaceComment(pointer, parentId || null)
  }

  function handleCanvasContextMenu(event) {
    event.preventDefault()
    // Context menu type depends on selection state, not cursor target.
    void checkPasteAvailabilityOnMenuOpen()
    if (selectedImageIds.length > 0) {
      setMenuState({ type: 'image', x: event.clientX, y: event.clientY })
      return
    }
    setMenuState({ type: 'canvas', x: event.clientX, y: event.clientY })
  }

  function handleNormalizeHeight() {
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    if (selectedImageIds.length === 0) return
    const prevImages = imagesRef.current
    const prevSelected = selectedIdsRef.current
    const selected = images.filter((image) => selectedImageIds.includes(image.id))
    const ordered = [...selected].sort((a, b) => a.y - b.y || a.x - b.x)
    const avgH = ordered.reduce((total, image) => total + getImageSize(image).height, 0) / ordered.length
    const minX = Math.min(...ordered.map((image) => image.x))
    const minY = Math.min(...ordered.map((image) => image.y))
    const maxX = Math.max(...ordered.map((image) => image.x + getImageSize(image).width))
    const targetWidth = Math.max(maxX - minX, 800)
    const resized = ordered.map((image) => {
      const size = getImageSize(image)
      return { ...image, width: (size.width / size.height) * avgH, height: avgH }
    })
    const laidOut = packRows(resized, minX, minY, targetWidth, IMAGE_SPACING)
    const byId = new Map(laidOut.map((image) => [image.id, image]))
    setImages((prev) => prev.map((image) => byId.get(image.id) ?? image))
    setMenuState(null)
    commitHistory(prevImages, prevSelected)
  }

  function handleNormalizeWidth() {
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    if (selectedImageIds.length === 0) return
    const prevImages = imagesRef.current
    const prevSelected = selectedIdsRef.current
    const selected = images.filter((image) => selectedImageIds.includes(image.id))
    const ordered = [...selected].sort((a, b) => a.y - b.y || a.x - b.x)
    const avgW = ordered.reduce((total, image) => total + getImageSize(image).width, 0) / ordered.length
    const minX = Math.min(...ordered.map((image) => image.x))
    const minY = Math.min(...ordered.map((image) => image.y))
    const maxX = Math.max(...ordered.map((image) => image.x + getImageSize(image).width))
    const targetWidth = Math.max(maxX - minX, 800)
    const resized = ordered.map((image) => {
      const size = getImageSize(image)
      return { ...image, width: avgW, height: (size.height / size.width) * avgW }
    })
    const laidOut = packRows(resized, minX, minY, targetWidth, IMAGE_SPACING)
    const byId = new Map(laidOut.map((image) => [image.id, image]))
    setImages((prev) => prev.map((image) => byId.get(image.id) ?? image))
    setMenuState(null)
    commitHistory(prevImages, prevSelected)
  }

  function handleOptimizeLayout() {
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    if (selectedImageIds.length === 0) return
    const prevImages = imagesRef.current
    const prevSelected = selectedIdsRef.current
    const selected = images.filter((image) => selectedImageIds.includes(image.id))
    const ordered = [...selected].sort((a, b) => a.y - b.y || a.x - b.x)
    const totalArea = ordered.reduce((total, image) => {
      const size = getImageSize(image)
      return total + size.width * size.height
    }, 0)
    const targetRowWidth = Math.max(900, Math.sqrt(totalArea) * 1.7)
    const items = ordered.map((image) => {
      const size = getImageSize(image)
      return { ...image, width: size.width, height: size.height }
    })
    const packed = packRows(items, 0, 0, targetRowWidth, IMAGE_SPACING)
    const originalMinX = Math.min(...ordered.map((image) => image.x))
    const originalMinY = Math.min(...ordered.map((image) => image.y))
    const minX = Math.min(...packed.map((image) => image.x))
    const minY = Math.min(...packed.map((image) => image.y))
    const optimized = packed.map((image) => ({ ...image, x: originalMinX + (image.x - minX), y: originalMinY + (image.y - minY) }))
    const byId = new Map(optimized.map((image) => [image.id, image]))
    setImages((prev) => prev.map((image) => byId.get(image.id) ?? image))
    setMenuState(null)
    commitHistory(prevImages, prevSelected)
  }

  function handleAlignSelected(mode) {
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    if (selectedImageIds.length < 2) return
    const prevImages = imagesRef.current
    const prevSelected = selectedIdsRef.current
    const selectedSet = new Set(selectedImageIds)
    const selected = images.filter((image) => selectedSet.has(image.id))
    if (selected.length < 2) return

    const left = Math.min(...selected.map((image) => image.x))
    const top = Math.min(...selected.map((image) => image.y))
    const right = Math.max(...selected.map((image) => image.x + getImageSize(image).width))
    const bottom = Math.max(...selected.map((image) => image.y + getImageSize(image).height))
    const centerX = (left + right) / 2
    const centerY = (top + bottom) / 2

    setImages((prev) =>
      prev.map((image) => {
        if (!selectedSet.has(image.id)) return image
        const size = getImageSize(image)
        if (mode === 'left') return { ...image, x: left }
        if (mode === 'right') return { ...image, x: right - size.width }
        if (mode === 'top') return { ...image, y: top }
        if (mode === 'bottom') return { ...image, y: bottom - size.height }
        if (mode === 'hcenter') return { ...image, x: centerX - size.width / 2 }
        if (mode === 'vcenter') return { ...image, y: centerY - size.height / 2 }
        return image
      }),
    )
    setMenuState(null)
    commitHistory(prevImages, prevSelected)
  }

  function handleCreateNewBoard() {
    window.open(`/board/${generateBoardId()}`, '_blank', 'noopener,noreferrer')
    setMenuState(null)
  }

  function handleDeleteBoard() {
    const confirmed = window.confirm('Delete this board? This action cannot be undone.')
    if (!confirmed) return
    localStorage.removeItem(storageKey)
    localStorage.removeItem(snappingStorageKey)
    localStorage.removeItem(imageSnappingStorageKey)
    setImages([])
    setComments([])
    setSelectedImageIds([])
    setMenuState(null)
    navigate(`/board/${generateBoardId()}`, { replace: true })
  }

  function handleToggleSnapping() {
    setIsSnappingEnabled((prev) => !prev)
    setMenuState(null)
  }

  function handleToggleImageSnapping() {
    setIsImageSnappingEnabled((prev) => !prev)
    setMenuState(null)
  }

  function handleToggleCanvasLock() {
    setIsCanvasLocked((prev) => !prev)
    setPanState(null)
    setMenuState(null)
  }

  async function handleDownloadAllImages() {
    if (images.length === 0) {
      setMenuState(null)
      return
    }
    const zipEntries = (
      await Promise.all(
        images.map(async (image, index) => {
          try {
            const storedBlob = await getImageBlobById(image.id)
            if (storedBlob) {
              const ext = getFileExtensionFromMime(storedBlob.type || 'image/png')
              const bytes = await blobToBytes(storedBlob)
              return { name: `image-${index + 1}.${ext}`, bytes }
            }
          } catch {
            // Fall through to fetch-based fallback.
          }
          const parsed = parseDataUrl(image.src)
          if (parsed) {
            const ext = getFileExtensionFromMime(parsed.mimeType)
            return { name: `image-${index + 1}.${ext}`, bytes: parsed.bytes }
          }

          try {
            const response = await fetch(image.src)
            if (!response.ok) return null
            const blob = await response.blob()
            const ext = getFileExtensionFromMime(blob.type || 'image/png')
            const bytes = await blobToBytes(blob)
            return { name: `image-${index + 1}.${ext}`, bytes }
          } catch {
            return null
          }
        }),
      )
    ).filter(Boolean)

    if (zipEntries.length === 0) {
      setMenuState(null)
      return
    }

    const zipBlob = createZipBlob(zipEntries)
    const url = URL.createObjectURL(zipBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `board-${boardId}.zip`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    setMenuState(null)
  }

  async function handlePasteAction() {
    const result = await pasteFromClipboard()
    if (result === 'locked') return
    if (result === 'pasted') return
    if (result === 'denied') {
      setPasteFeedback('Clipboard permission denied')
      return
    }
    if (result === 'unsupported') {
      setPasteFeedback('Clipboard read requires HTTPS')
      return
    }
    setPasteFeedback('Clipboard is empty')
  }

  function handleResetView() {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const nextScale = 1
    setScale(nextScale)
    if (images.length === 0) {
      setOffsetX(rect.width / 2)
      setOffsetY(rect.height / 2)
      return
    }
    const minX = Math.min(...images.map((image) => image.x))
    const minY = Math.min(...images.map((image) => image.y))
    const maxX = Math.max(...images.map((image) => image.x + getImageSize(image).width))
    const maxY = Math.max(...images.map((image) => image.y + getImageSize(image).height))
    const contentCenterX = (minX + maxX) / 2
    const contentCenterY = (minY + maxY) / 2
    setOffsetX(rect.width / 2 - contentCenterX * nextScale)
    setOffsetY(rect.height / 2 - contentCenterY * nextScale)
  }

  function handleResetCropTransform() {
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    if (selectedImageIds.length !== 1) return
    const imageId = selectedImageIds[0]
    const image = imagesRef.current.find((item) => item.id === imageId)
    if (!image || !canResetCropOrTransform(image)) {
      setMenuState(null)
      return
    }
    const prevImages = imagesRef.current
    const prevSelected = selectedIdsRef.current
    setImages((prev) =>
      prev.map((item) => {
        if (item.id !== imageId) return item
        return {
          ...item,
          src: item.originalSrc || item.src,
          width: item.originalWidth ?? item.width,
          height: item.originalHeight ?? item.height,
          cropBounds: null,
          scale: 1,
          rotation: 0,
        }
      }),
    )
    setMenuState(null)
    commitHistory(prevImages, prevSelected)
  }

  function handleToggleCommentMode() {
    setIsCommentMode((prev) => {
      if (prev) closeCommentEditor()
      return !prev
    })
    setMenuState(null)
  }

  function handlePlaceComment(pointer, parentId = null) {
    const nextZIndex = commentsRef.current.reduce((max, item) => Math.max(max, item.zIndex ?? 0), -1) + 1
    const parent = parentId ? imagesRef.current.find((image) => image.id === parentId) : null
    const localPosition = parent
      ? { x: pointer.x - parent.x, y: pointer.y - parent.y }
      : { x: pointer.x, y: pointer.y }
    const randomColor = COMMENT_COLORS[Math.floor(Math.random() * COMMENT_COLORS.length)] || DEFAULT_COMMENT_COLOR
    const comment = {
      id: crypto.randomUUID(),
      text: '',
      position: localPosition,
      isDraft: true,
      createdAt: new Date().toISOString(),
      color: randomColor,
      zIndex: nextZIndex,
      parentId: parent ? parent.id : null,
    }
    setComments((prev) => [...prev, comment])
    setActiveCommentRef({ commentId: comment.id })
    setCommentDraft('')
  }

  function handleCommentPinMouseDown(event, commentId) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    if (isCanvasLocked) return
    suppressCommentPinClickRef.current = false
    const rect = canvasRef.current?.getBoundingClientRect()
    const comment = commentsRef.current.find((entry) => entry.id === commentId)
    if (!rect || !comment) return
    const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetXRef.current, offsetYRef.current, scaleRef.current)
    const startWorld = getCommentWorldPosition(comment, imagesRef.current)
    setCommentDragState({
      commentId,
      startPointerX: pointer.x,
      startPointerY: pointer.y,
      startX: startWorld.x,
      startY: startWorld.y,
      parentId: comment.parentId ?? null,
      historySnapshot: {
        images: imagesRef.current,
        comments: commentsRef.current,
        selectedImageIds: selectedIdsRef.current,
      },
    })
  }

  function handleCommentPinClick(event, commentId) {
    event.preventDefault()
    event.stopPropagation()
    if (suppressCommentPinClickRef.current) {
      suppressCommentPinClickRef.current = false
      return
    }
    openCommentEditor(commentId)
  }

  function handleSaveComment() {
    if (!activeCommentRef) return 'none'
    const normalizedDraft = commentDraft.trim()
    if (!activeCommentRef.commentId) return 'none'
    const currentComment = commentsRef.current.find((item) => item.id === activeCommentRef.commentId)
    if (!currentComment) return 'none'
    const normalizedCurrent = (currentComment.text ?? '').trim()
    if (!hasCommentText(normalizedDraft)) {
      const prevComments = commentsRef.current
      const prevSelected = selectedIdsRef.current
      setComments((prev) => prev.filter((comment) => comment.id !== activeCommentRef.commentId))
      if (normalizedCurrent.length > 0 || currentComment.isDraft) {
        commitHistory(imagesRef.current, prevSelected, prevComments)
      }
      return 'deleted'
    }
    if (normalizedCurrent === normalizedDraft && !currentComment.isDraft) return 'none'
    const prevComments = commentsRef.current
    const prevSelected = selectedIdsRef.current
    setComments((prev) =>
      prev.map((comment) =>
        comment.id === activeCommentRef.commentId ? { ...comment, text: normalizedDraft, isDraft: false } : comment,
      ),
    )
    commitHistory(imagesRef.current, prevSelected, prevComments)
    commentInitialTextRef.current = normalizedDraft
    setCommentDraft(normalizedDraft)
    if (normalizedCurrent !== normalizedDraft) showCommentSavedFeedback()
    return currentComment.isDraft ? 'created' : 'updated'
  }

  function handleDeleteComment() {
    if (!activeCommentRef) return
    if (!activeCommentRef.commentId) {
      closeCommentEditor()
      return
    }
    const prevComments = commentsRef.current
    const prevSelected = selectedIdsRef.current
    setComments((prev) => prev.filter((comment) => comment.id !== activeCommentRef.commentId))
    commitHistory(imagesRef.current, prevSelected, prevComments)
    closeCommentEditor()
  }

  function handleCommentEditorInputBlur(event) {
    if (commentEditorRef.current?.contains(event.relatedTarget)) return
    handleSaveComment()
  }

  function handleCommentEditorInputKeyDown(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.blur()
  }

  function handleSendComment() {
    handleSaveComment()
    closeCommentEditor()
  }

  const selectedImage = selectedImageIds.length === 1 ? images.find((image) => image.id === selectedImageIds[0]) ?? null : null
  const selectedRenderedBounds = selectedImage ? getRenderedImageBounds(selectedImage, imageNaturalSizes[selectedImage.id]) : null
  const selectedOutlines = images
    .filter((image) => selectedImageIds.includes(image.id))
    .map((image) => ({
      id: image.id,
      bounds: getRenderedImageBounds(image, imageNaturalSizes[image.id]),
    }))
  const resizeHandleDefs = selectedImage && selectedRenderedBounds
    ? [
        { handle: 'nw', x: selectedRenderedBounds.x, y: selectedRenderedBounds.y },
        { handle: 'n', x: selectedRenderedBounds.x + selectedRenderedBounds.width / 2, y: selectedRenderedBounds.y },
        { handle: 'ne', x: selectedRenderedBounds.x + selectedRenderedBounds.width, y: selectedRenderedBounds.y },
        { handle: 'e', x: selectedRenderedBounds.x + selectedRenderedBounds.width, y: selectedRenderedBounds.y + selectedRenderedBounds.height / 2 },
        { handle: 'se', x: selectedRenderedBounds.x + selectedRenderedBounds.width, y: selectedRenderedBounds.y + selectedRenderedBounds.height },
        { handle: 's', x: selectedRenderedBounds.x + selectedRenderedBounds.width / 2, y: selectedRenderedBounds.y + selectedRenderedBounds.height },
        { handle: 'sw', x: selectedRenderedBounds.x, y: selectedRenderedBounds.y + selectedRenderedBounds.height },
        { handle: 'w', x: selectedRenderedBounds.x, y: selectedRenderedBounds.y + selectedRenderedBounds.height / 2 },
      ]
    : []
  const canResetSelectedImageCropTransform = selectedImage ? canResetCropOrTransform(selectedImage) : false
  const cropModeImage = cropMode ? images.find((image) => image.id === cropMode.id) ?? null : null
  const cropModeImageBounds = cropModeImage ? getImageBounds(cropModeImage) : null
  const cropMaskInsets = cropMode && cropModeImageBounds
    ? {
        left: clamp(cropMode.rect.x - cropModeImageBounds.left, 0, cropModeImageBounds.width),
        top: clamp(cropMode.rect.y - cropModeImageBounds.top, 0, cropModeImageBounds.height),
        right: clamp(cropModeImageBounds.right - (cropMode.rect.x + cropMode.rect.width), 0, cropModeImageBounds.width),
        bottom: clamp(cropModeImageBounds.bottom - (cropMode.rect.y + cropMode.rect.height), 0, cropModeImageBounds.height),
      }
    : null
  const quickCropRect = quickCropState
    ? {
        left: Math.min(quickCropState.startX, quickCropState.currentX),
        top: Math.min(quickCropState.startY, quickCropState.currentY),
        width: Math.abs(quickCropState.currentX - quickCropState.startX),
        height: Math.abs(quickCropState.currentY - quickCropState.startY),
      }
    : null
  const clusterDraftRect = clusterDrawState
    ? {
        left: Math.min(clusterDrawState.startX, clusterDrawState.currentX),
        top: Math.min(clusterDrawState.startY, clusterDrawState.currentY),
        width: Math.abs(clusterDrawState.currentX - clusterDrawState.startX),
        height: Math.abs(clusterDrawState.currentY - clusterDrawState.startY),
      }
    : null
  const hasImages = images.length > 0
  const shouldShowWorldOrigin = scale < 1.2 || !hasImages
  const commentPins = comments.map((comment) => {
    const world = getCommentWorldPosition(comment, images)
    return {
      commentId: comment.id,
      text: comment.text ?? '',
      isDraft: Boolean(comment.isDraft),
      color: typeof comment.color === 'string' && comment.color ? comment.color : DEFAULT_COMMENT_COLOR,
      zIndex: typeof comment.zIndex === 'number' ? comment.zIndex : 0,
      worldX: world.x,
      worldY: world.y,
    }
  })
  const activeComment = activeCommentRef
    ? comments.find((comment) => comment.id === activeCommentRef.commentId) ?? null
    : null
  const activeCommentAnchor = activeComment
    ? getCommentWorldPosition(activeComment, images)
    : null
  const activeCommentEditorPosition = activeCommentAnchor
    ? (() => {
        const pinX = offsetX + activeCommentAnchor.x * scale
        const pinY = offsetY + activeCommentAnchor.y * scale
        const maxPanelWidth = Math.max(180, viewportSize.width - COMMENT_PANEL_VIEWPORT_PADDING * 2)
        const panelWidth = Math.min(commentEditorSize.width || COMMENT_PANEL_FALLBACK_WIDTH, maxPanelWidth)
        const panelHeight = commentEditorSize.height || COMMENT_PANEL_FALLBACK_HEIGHT
        const maxLeft = Math.max(COMMENT_PANEL_VIEWPORT_PADDING, viewportSize.width - COMMENT_PANEL_VIEWPORT_PADDING - panelWidth)
        const maxTop = Math.max(COMMENT_PANEL_VIEWPORT_PADDING, viewportSize.height - COMMENT_PANEL_VIEWPORT_PADDING - panelHeight)
        const wouldOverflowRight = pinX + COMMENT_POPUP_OFFSET + panelWidth > viewportSize.width - COMMENT_PANEL_VIEWPORT_PADDING
        const preferredLeft = wouldOverflowRight
          ? pinX - COMMENT_POPUP_OFFSET - panelWidth
          : pinX + COMMENT_POPUP_OFFSET
        const preferredTop = pinY + COMMENT_POPUP_OFFSET
        return {
          left: clamp(preferredLeft, COMMENT_PANEL_VIEWPORT_PADDING, maxLeft),
          top: clamp(preferredTop, COMMENT_PANEL_VIEWPORT_PADDING, maxTop),
        }
      })()
    : null

  return (
    <div
      ref={canvasRef}
      className={`canvas-viewport ${isQuickCropKeyDown && !cropMode ? 'is-crop-key-held' : ''} ${isCommentMode ? 'is-comment-mode' : ''} ${isClusterMode ? 'is-cluster-mode' : ''} ${isCanvasLocked ? 'is-locked' : ''} ${isSpaceDown && canPan && !cropMode && !quickCropState ? 'is-space-pan-ready' : ''} ${panState ? 'is-panning' : ''}`}
      style={{
        '--canvas-grid-size': `${GRID_SIZE}px`,
        '--canvas-scale': scale,
        '--canvas-inverse-scale': 1 / scale,
      }}
      onDragOverCapture={handleDragOver}
      onDropCapture={handleDrop}
      onMouseDown={handleCanvasMouseDown}
      onClick={handleCanvasClick}
      onContextMenu={handleCanvasContextMenu}
    >
      <div
        className="canvas-camera"
        style={{ transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`, transformOrigin: '0 0' }}
      >
        <div className="canvas-world">
          {shouldShowWorldOrigin ? <WorldOrigin /> : null}
          {isImageSnappingEnabled && smartGuides.vertical ? (
            <div
              className="canvas-smart-guide is-vertical"
              style={{
                left: `${smartGuides.vertical.x}px`,
                top: `${smartGuides.vertical.top}px`,
                height: `${Math.max(0, smartGuides.vertical.bottom - smartGuides.vertical.top)}px`,
              }}
            />
          ) : null}
          {isImageSnappingEnabled && smartGuides.horizontal ? (
            <div
              className="canvas-smart-guide is-horizontal"
              style={{
                left: `${smartGuides.horizontal.left}px`,
                top: `${smartGuides.horizontal.y}px`,
                width: `${Math.max(0, smartGuides.horizontal.right - smartGuides.horizontal.left)}px`,
              }}
            />
          ) : null}
          {clusters.map((cluster) => (
            (() => {
              const bounds = getBoundsFromCluster(cluster)
              const clusterName = cluster.name || cluster.title || 'Cluster'
              const isSelected = selectedClusterId === cluster.id
              return (
                <div
                  key={cluster.id}
                  className={`canvas-cluster ${isSelected ? 'is-selected' : ''}`.trim()}
                  style={{
                    left: `${bounds.left}px`,
                    top: `${bounds.top}px`,
                    width: `${bounds.width}px`,
                    height: `${bounds.height}px`,
                  }}
                  onMouseDown={(event) => handleClusterMouseDown(event, cluster)}
                >
                  <div className="canvas-cluster__header" onMouseDown={(event) => event.stopPropagation()}>
                    {editingClusterId === cluster.id ? (
                      <input
                        className="canvas-cluster__title-input"
                        value={editingTitle}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        onBlur={handleClusterTitleInputBlur}
                        onKeyDown={handleClusterTitleInputKeyDown}
                        onMouseDown={(event) => event.stopPropagation()}
                        style={{ width: `${Math.max(64, Math.min(bounds.width - 54, (editingTitle.length + 2) * (7 / scale))) || 64}px` }}
                        maxLength={80}
                        autoFocus
                      />
                    ) : (
                      <div className="canvas-cluster__title-wrap">
                        <button
                          type="button"
                          className="canvas-cluster__title"
                          onClick={(event) => handleStartClusterTitleEdit(event, cluster)}
                          title={isCanvasLocked ? 'Unlock canvas to rename cluster' : 'Rename cluster'}
                        >
                          {clusterName}
                        </button>
                        <button
                          type="button"
                          className="canvas-cluster__edit-btn"
                          onClick={(event) => handleStartClusterTitleEdit(event, cluster)}
                          aria-label="Rename cluster"
                          title="Rename cluster"
                        >
                          <Pencil size={12} strokeWidth={ICON_STROKE_WIDTH} />
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      className="canvas-cluster__menu-toggle"
                      onClick={(event) => handleToggleClusterMenu(event, cluster.id)}
                      aria-label="Cluster options"
                      title="Cluster options"
                    >
                      <MoreHorizontal size={16} strokeWidth={ICON_STROKE_WIDTH} />
                    </button>
                    {openClusterMenuId === cluster.id ? (
                      <div className="canvas-cluster__menu" onMouseDown={(event) => event.stopPropagation()}>
                        <button type="button" className="canvas-cluster__menu-item" onClick={(event) => handleStartClusterTitleEdit(event, cluster)}>
                          Rename
                        </button>
                        <button type="button" className="canvas-cluster__menu-item" onClick={(event) => handleUngroupCluster(event, cluster.id)}>
                          Ungroup
                        </button>
                        <button type="button" className="canvas-cluster__menu-item" onClick={(event) => handleUngroupCluster(event, cluster.id)}>
                          Delete Cluster
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })()
          ))}
          {clusterDraftRect && clusterDraftRect.width > 0 && clusterDraftRect.height > 0 ? (
            <div
              className="canvas-cluster canvas-cluster--draft"
              style={{
                left: `${clusterDraftRect.left}px`,
                top: `${clusterDraftRect.top}px`,
                width: `${clusterDraftRect.width}px`,
                height: `${clusterDraftRect.height}px`,
              }}
            />
          ) : null}
          {images.map((image) => {
            const size = getImageSize(image)
            const renderSrc = getRenderableImageSrc(image.src)
            return (
              <div
                key={image.id}
                data-image-id={image.id}
                className="canvas-image-node"
                style={{
                  left: `${image.x}px`,
                  top: `${image.y}px`,
                  width: `${size.width}px`,
                  height: `${size.height}px`,
                }}
                onMouseDown={(event) => handleImageMouseDown(event, image)}
              >
                {renderSrc ? (
                  <img
                    src={renderSrc}
                    alt=""
                    className="canvas-image"
                    onLoad={(event) => {
                      const element = event.currentTarget
                      const width = element.naturalWidth || 0
                      const height = element.naturalHeight || 0
                      if (!width || !height) return
                      setImageNaturalSizes((prev) => {
                        const current = prev[image.id]
                        if (current?.width === width && current?.height === height) return prev
                        return { ...prev, [image.id]: { width, height } }
                      })
                    }}
                    draggable={false}
                  />
                ) : null}
              </div>
            )
          })}
          {selectedOutlines.map((outline) => (
            <div
              key={`outline-${outline.id}`}
              className="canvas-selection-outline"
              style={{
                left: `${outline.bounds.x}px`,
                top: `${outline.bounds.y}px`,
                width: `${outline.bounds.width}px`,
                height: `${outline.bounds.height}px`,
              }}
            />
          ))}
          {commentPins.map((pin) => (
            <button
              key={pin.commentId}
              type="button"
              className={`canvas-comment-pin ${activeCommentRef?.commentId === pin.commentId ? 'is-active' : ''} ${pin.isDraft ? 'is-draft' : ''}`.trim()}
              style={{ left: `${pin.worldX}px`, top: `${pin.worldY}px`, zIndex: `${21 + pin.zIndex}`, backgroundColor: pin.color }}
              onMouseDown={(event) => handleCommentPinMouseDown(event, pin.commentId)}
              onClick={(event) => handleCommentPinClick(event, pin.commentId)}
              title={pin.text ? `Comment: ${pin.text}` : 'Comment'}
              aria-label={pin.text ? 'Comment with text' : 'Comment draft'}
            />
          ))}
          {selectedImage ? resizeHandleDefs.map((handleDef) => (
            <button
              key={handleDef.handle}
              type="button"
              className={`canvas-resize-handle is-${handleDef.handle}`.trim()}
              style={{ left: `${handleDef.x}px`, top: `${handleDef.y}px` }}
              onMouseDown={(event) => handleResizeHandleMouseDown(event, selectedImage, handleDef.handle)}
            />
          )) : null}
          {cropMode ? (
            <>
              {cropModeImageBounds && cropMaskInsets ? (
                <div
                  className="canvas-crop-mask-layer"
                  style={{
                    left: `${cropModeImageBounds.left}px`,
                    top: `${cropModeImageBounds.top}px`,
                    width: `${cropModeImageBounds.width}px`,
                    height: `${cropModeImageBounds.height}px`,
                  }}
                >
                  <div className="canvas-crop-mask is-top" style={{ height: `${cropMaskInsets.top}px` }} />
                  <div className="canvas-crop-mask is-bottom" style={{ height: `${cropMaskInsets.bottom}px` }} />
                  <div
                    className="canvas-crop-mask is-left"
                    style={{
                      top: `${cropMaskInsets.top}px`,
                      width: `${cropMaskInsets.left}px`,
                      height: `${Math.max(0, cropModeImageBounds.height - cropMaskInsets.top - cropMaskInsets.bottom)}px`,
                    }}
                  />
                  <div
                    className="canvas-crop-mask is-right"
                    style={{
                      top: `${cropMaskInsets.top}px`,
                      width: `${cropMaskInsets.right}px`,
                      height: `${Math.max(0, cropModeImageBounds.height - cropMaskInsets.top - cropMaskInsets.bottom)}px`,
                    }}
                  />
                </div>
              ) : null}
              <div
                className="canvas-crop-frame"
                style={{
                  left: `${cropMode.rect.x}px`,
                  top: `${cropMode.rect.y}px`,
                  width: `${cropMode.rect.width}px`,
                  height: `${cropMode.rect.height}px`,
                }}
                onMouseDown={handleCropFrameMouseDown}
              />
              {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handle) => {
                const x = cropMode.rect.x + (handle.includes('w') ? 0 : handle.includes('e') ? cropMode.rect.width : cropMode.rect.width / 2)
                const y = cropMode.rect.y + (handle.includes('n') ? 0 : handle.includes('s') ? cropMode.rect.height : cropMode.rect.height / 2)
                const isCorner = handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw'
                return (
                  <button
                    key={handle}
                    type="button"
                    className={`canvas-crop-handle is-${handle} ${isCorner ? 'is-corner' : ''}`.trim()}
                    style={{ left: `${x}px`, top: `${y}px` }}
                    onMouseDown={(event) => handleCropHandleMouseDown(event, handle)}
                  />
                )
              })}
            </>
          ) : null}
          {quickCropRect && quickCropRect.width > 0 && quickCropRect.height > 0 ? (
            <div
              className="canvas-quick-crop-frame"
              style={{
                left: `${quickCropRect.left}px`,
                top: `${quickCropRect.top}px`,
                width: `${quickCropRect.width}px`,
                height: `${quickCropRect.height}px`,
              }}
            />
          ) : null}
        </div>
      </div>
      {images.length === 0 ? (
        <div className="canvas-hint">
          Drag and drop images here
          <br />
          Press Ctrl + V
        </div>
      ) : null}

      {marqueeState ? (
        <div
          className="canvas-marquee"
          style={{
            left: `${Math.min(marqueeState.startClientX, marqueeState.currentClientX)}px`,
            top: `${Math.min(marqueeState.startClientY, marqueeState.currentClientY)}px`,
            width: `${Math.abs(marqueeState.currentClientX - marqueeState.startClientX)}px`,
            height: `${Math.abs(marqueeState.currentClientY - marqueeState.startClientY)}px`,
          }}
        />
      ) : null}

      {activeCommentRef && activeCommentEditorPosition ? (
        <div
          ref={commentEditorRef}
          className="canvas-comment-editor"
          style={{ left: `${activeCommentEditorPosition.left}px`, top: `${activeCommentEditorPosition.top}px` }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <textarea
            className="canvas-comment-editor__input"
            value={commentDraft}
            onChange={(event) => handleCommentDraftChange(event.target.value)}
            onBlur={handleCommentEditorInputBlur}
            onKeyDown={handleCommentEditorInputKeyDown}
            placeholder="Add note..."
            autoFocus
          />
          <div className="canvas-comment-editor__footer">
            <button
              type="button"
              className="btn btn-icon canvas-comment-editor__icon-btn canvas-comment-editor__icon-btn--delete is-danger"
              onClick={handleDeleteComment}
              aria-label="Delete comment"
              title="Delete comment"
            >
              <Trash2 size={16} strokeWidth={ICON_STROKE_WIDTH} />
            </button>
            <span className={`canvas-comment-editor__save-state ${commentSaveState === 'saved' ? 'is-visible' : ''}`.trim()}>
              Saved
            </span>
            <button
              type="button"
              className="btn btn-icon canvas-comment-editor__send-btn"
              onClick={handleSendComment}
              aria-label="Send comment"
              title="Send comment"
            >
              <SendHorizontal size={15} strokeWidth={ICON_STROKE_WIDTH} />
            </button>
          </div>
        </div>
      ) : null}

      {menuState ? (
        <div
          ref={menuRef}
          className="canvas-context-menu"
          style={{ left: `${menuState.x}px`, top: `${menuState.y}px` }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {menuState.type === 'image' ? (
            <>
              <button
                type="button"
                className={`canvas-menu-item ${selectedImageIds.length === 1 ? '' : 'is-disabled'}`.trim()}
                onClick={() => enterCropMode(selectedImageIds[0])}
                disabled={selectedImageIds.length !== 1}
              >
                <MenuIcon>
                  <Crop size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">Crop</span>
              </button>
              <button type="button" className="canvas-menu-item" onClick={handleToggleCommentMode}>
                <MenuIcon>
                  <MessageSquare size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">{isCommentMode ? 'Disable comment mode' : 'Enable comment mode'}</span>
              </button>
              {selectedImageIds.length === 1 && canResetSelectedImageCropTransform ? (
                <button
                  type="button"
                  className={`canvas-menu-item ${canResetSelectedImageCropTransform ? '' : 'is-disabled'}`.trim()}
                  onClick={handleResetCropTransform}
                  disabled={!canResetSelectedImageCropTransform}
                >
                  <MenuIcon>
                    <RotateCcw size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                  </MenuIcon>
                  <span className="canvas-menu-item__label">Reset Crop / Transform</span>
                </button>
              ) : null}
              <div className="canvas-context-menu__divider" />
              <button type="button" className="canvas-menu-item" onClick={handleNormalizeHeight}>
                <MenuIcon>
                  <StretchVertical size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">Normalize height</span>
              </button>
              <button type="button" className="canvas-menu-item" onClick={handleNormalizeWidth}>
                <MenuIcon>
                  <StretchHorizontal size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">Normalize width</span>
              </button>
              <button type="button" className="canvas-menu-item" onClick={handleOptimizeLayout}>
                <MenuIcon>
                  <LayoutGrid size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">Optimize layout</span>
                <span className="canvas-menu-item__badge">PRO</span>
              </button>
              {selectedImageIds.length >= 2 ? (
                <>
                  <div className="canvas-context-menu__divider" />
                  <div className="canvas-menu-submenu">
                    <button type="button" className="canvas-menu-item canvas-menu-submenu__trigger">
                      <MenuIcon>
                        <AlignLeft size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                      </MenuIcon>
                      <span className="canvas-menu-item__label">Align</span>
                      <span className="canvas-menu-submenu__chevron" aria-hidden="true"><ChevronRight size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></span>
                    </button>
                    <div className="canvas-menu-submenu__panel">
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('left')}>
                        <MenuIcon><AlignLeft size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon>
                        <span className="canvas-menu-item__label">Align Left</span>
                      </button>
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('right')}>
                        <MenuIcon><AlignRight size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon>
                        <span className="canvas-menu-item__label">Align Right</span>
                      </button>
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('top')}>
                        <MenuIcon><AlignTop size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon>
                        <span className="canvas-menu-item__label">Align Top</span>
                      </button>
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('bottom')}>
                        <MenuIcon><AlignBottom size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon>
                        <span className="canvas-menu-item__label">Align Bottom</span>
                      </button>
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('hcenter')}>
                        <MenuIcon><AlignCenterHorizontal size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon>
                        <span className="canvas-menu-item__label">Align Horizontal Center</span>
                      </button>
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('vcenter')}>
                        <MenuIcon><AlignCenterVertical size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon>
                        <span className="canvas-menu-item__label">Align Vertical Center</span>
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                className={`canvas-menu-item ${isPasteAvailable ? '' : 'is-disabled'}`.trim()}
                onClick={handlePasteAction}
                disabled={!isPasteAvailable}
              >
                <MenuIcon>
                  <Clipboard size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">Paste</span>
              </button>
              <button type="button" className="canvas-menu-item" onClick={handleToggleCommentMode}>
                <MenuIcon>
                  <MessageSquare size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">{isCommentMode ? 'Disable comment mode' : 'Enable comment mode'}</span>
              </button>
              <div className="canvas-context-menu__divider" />
              <button type="button" className="canvas-menu-item" onClick={handleCreateNewBoard}>
                <MenuIcon>
                  <Plus size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">Create new board</span>
              </button>
              <button type="button" className="canvas-menu-item" onClick={handleToggleSnapping}>
                <MenuIcon>
                  <Grid2x2 size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">
                  Toggle snapping {isSnappingEnabled ? '(On)' : '(Off)'}
                </span>
              </button>
              <button type="button" className="canvas-menu-item" onClick={handleToggleImageSnapping}>
                <MenuIcon>
                  <AlignCenterHorizontal size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">
                  Snap to Images {isImageSnappingEnabled ? '(On)' : '(Off)'}
                </span>
                {isImageSnappingEnabled ? (
                  <span className="canvas-menu-item__state-icon" aria-hidden="true">
                    <Check size={14} strokeWidth={ICON_STROKE_WIDTH} />
                  </span>
                ) : null}
              </button>
              <button type="button" className="canvas-menu-item" onClick={handleToggleCanvasLock}>
                <MenuIcon>
                  {isCanvasLocked ? <Unlock size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /> : <Lock size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />}
                </MenuIcon>
                <span className="canvas-menu-item__label">
                  {isCanvasLocked ? 'Unlock Canvas' : 'Lock Canvas'}
                </span>
              </button>
              <button type="button" className="canvas-menu-item" onClick={handleResetView}>
                <MenuIcon>
                  <RotateCcw size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">Reset view</span>
              </button>
              <button
                type="button"
                className={`canvas-menu-item ${hasImages ? '' : 'is-disabled'}`.trim()}
                onClick={handleDownloadAllImages}
                disabled={!hasImages}
              >
                <MenuIcon>
                  <Download size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">Download all images</span>
              </button>
              <div className="canvas-context-menu__divider" />
              <button type="button" className="canvas-menu-item is-danger" onClick={handleDeleteBoard}>
                <MenuIcon>
                  <Trash2 size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">Delete this board</span>
              </button>
            </>
          )}
        </div>
      ) : null}

      {isSnappingEnabled ? <div className="canvas-snapping-indicator">Snapping on</div> : null}
      {lockFeedback ? (
        <div className="canvas-lock-toast" role="status" aria-live="polite">
          <span className="canvas-lock-toast__icon" aria-hidden="true">
            <Lock size={14} strokeWidth={ICON_STROKE_WIDTH} />
          </span>
          <span>{lockFeedback}</span>
        </div>
      ) : null}
      {pasteFeedback ? <div className="canvas-feedback-indicator">{pasteFeedback}</div> : null}

    </div>
  )
}




