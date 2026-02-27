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
  ExternalLink,
  Grid2x2,
  Check,
  LayoutGrid,
  Lock,
  MessageSquare,
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
const MAGNETIC_SNAP_EDGE_THRESHOLD = 48
const MENU_ICON_SIZE = 18
const ICON_STROKE_WIDTH = 2.3
const SMART_SNAP_THRESHOLD = 4
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
const MAX_IMAGE_DIMENSION = 4096
const IMAGE_COMPRESSION_QUALITY = 0.8
const ALT_DRAG_HINT_STORAGE_KEY = 'seenAltDragHint'
const PALETTE_MIN_COLORS = 6
const PALETTE_MAX_COLORS = 12
const PALETTE_SAMPLE_SIZE = 48
const PALETTE_MAX_SAMPLES = 12000
const PALETTE_SIMILARITY_DELTA = 24
const LINK_THUMBNAIL_DEFAULT_WIDTH = 304
const LINK_THUMBNAIL_DEFAULT_HEIGHT = 214
const LINK_METADATA_CACHE_KEY = 'kanvaref:link-meta-cache-v1'
const LINK_THUMBNAIL_LOAD_TIMEOUT_MS = 5000

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
    magneticGroupId: typeof image.magneticGroupId === 'string' && image.magneticGroupId ? image.magneticGroupId : null,
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
    isTransformable: true,
    src,
    originalSrc: src,
    originalWidth: width,
    originalHeight: height,
    cropBounds: null,
    scale: 1,
    rotation: 0,
    comments: [],
    magneticGroupId: null,
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
    isTransformable: true,
    originalSrc: image.originalSrc || image.src,
    originalWidth: typeof image.originalWidth === 'number' ? image.originalWidth : width,
    originalHeight: typeof image.originalHeight === 'number' ? image.originalHeight : height,
    cropBounds: image.cropBounds ?? null,
    scale: typeof image.scale === 'number' ? image.scale : 1,
    rotation: typeof image.rotation === 'number' ? image.rotation : 0,
    comments: Array.isArray(image.comments) ? image.comments.map(normalizeImageComment).filter(Boolean) : [],
    magneticGroupId: typeof image.magneticGroupId === 'string' && image.magneticGroupId ? image.magneticGroupId : null,
  }
}

function normalizePaletteItem(palette) {
  if (!palette || typeof palette !== 'object') return null
  const colors = Array.isArray(palette.colors)
    ? palette.colors
      .filter((color) => typeof color === 'string')
      .map((color) => color.trim().toUpperCase())
      .filter((color) => /^#[0-9A-F]{6}$/.test(color))
      .slice(0, PALETTE_MAX_COLORS)
    : []
  if (colors.length === 0) return null
  return {
    id: typeof palette.id === 'string' && palette.id ? palette.id : crypto.randomUUID(),
    type: 'palette',
    isTransformable: false,
    x: typeof palette.x === 'number' ? palette.x : 0,
    y: typeof palette.y === 'number' ? palette.y : 0,
    colors,
    magneticGroupId: typeof palette.magneticGroupId === 'string' && palette.magneticGroupId ? palette.magneticGroupId : null,
    createdFromGroupId: typeof palette.createdFromGroupId === 'string' && palette.createdFromGroupId ? palette.createdFromGroupId : null,
    createdAt: typeof palette.createdAt === 'number' ? palette.createdAt : Date.now(),
  }
}

function normalizeLinkThumbnailItem(item) {
  if (!item || typeof item !== 'object') return null
  const hrefRaw = typeof item.href === 'string' ? item.href.trim() : ''
  let href = ''
  try {
    const parsed = new URL(hrefRaw)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') href = parsed.toString()
  } catch {
    href = ''
  }
  if (!href) return null
  const domain = typeof item.domain === 'string' && item.domain.trim()
    ? item.domain.trim()
    : new URL(href).hostname.replace(/^www\./, '')
  const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : href
  const imageUrl = sanitizeThumbnailImageUrl(item.imageUrl)
  const ogImageUrl = sanitizeThumbnailImageUrl(item.ogImageUrl)
  const screenshotUrl = sanitizeThumbnailImageUrl(item.screenshotUrl)
  const rawStatus = typeof item.thumbnailStatus === 'string' ? item.thumbnailStatus : ''
  const thumbnailStatus =
    rawStatus === 'loading' || rawStatus === 'loaded' || rawStatus === 'fallback' || rawStatus === 'error'
      ? rawStatus
      : Boolean(item.isLoading)
        ? 'loading'
        : imageUrl
          ? 'loaded'
          : 'fallback'
  const thumbnailSourceRaw = typeof item.thumbnailSource === 'string' ? item.thumbnailSource : ''
  const thumbnailSource =
    thumbnailSourceRaw === 'og' || thumbnailSourceRaw === 'screenshot' || thumbnailSourceRaw === 'placeholder'
      ? thumbnailSourceRaw
      : imageUrl
        ? 'og'
        : 'placeholder'
  return {
    id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
    type: 'link-thumbnail',
    isTransformable: false,
    x: typeof item.x === 'number' ? item.x : 0,
    y: typeof item.y === 'number' ? item.y : 0,
    width: LINK_THUMBNAIL_DEFAULT_WIDTH,
    height: LINK_THUMBNAIL_DEFAULT_HEIGHT,
    imageUrl,
    ogImageUrl,
    screenshotUrl,
    title,
    domain,
    href,
    siteName: typeof item.siteName === 'string' && item.siteName.trim() ? item.siteName.trim() : domain,
    thumbnailStatus,
    thumbnailSource,
    thumbnailFetched: Boolean(item.thumbnailFetched),
    magneticGroupId: typeof item.magneticGroupId === 'string' && item.magneticGroupId ? item.magneticGroupId : null,
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
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

function rgbToHex(r, g, b) {
  const toHex = (value) => value.toString(16).padStart(2, '0').toUpperCase()
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function colorDistance(a, b) {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return Math.hypot(dr, dg, db)
}

function dedupeColors(colors, delta = PALETTE_SIMILARITY_DELTA) {
  const deduped = []
  for (const color of colors) {
    if (!deduped.some((existing) => colorDistance(existing, color) <= delta)) deduped.push(color)
  }
  return deduped
}

function runKMeans(samples, k, iterations = 8) {
  if (!samples.length) return []
  const centroids = []
  for (let i = 0; i < k; i += 1) {
    centroids.push(samples[Math.floor((i / k) * samples.length)] ?? samples[0])
  }
  let assignments = new Array(samples.length).fill(0)
  for (let iter = 0; iter < iterations; iter += 1) {
    assignments = samples.map((sample) => {
      let bestIndex = 0
      let bestDistance = Infinity
      for (let i = 0; i < centroids.length; i += 1) {
        const distance = colorDistance(sample, centroids[i])
        if (distance < bestDistance) {
          bestDistance = distance
          bestIndex = i
        }
      }
      return bestIndex
    })

    const sums = new Array(k).fill(0).map(() => [0, 0, 0, 0])
    for (let i = 0; i < samples.length; i += 1) {
      const bucket = sums[assignments[i]]
      const sample = samples[i]
      bucket[0] += sample[0]
      bucket[1] += sample[1]
      bucket[2] += sample[2]
      bucket[3] += 1
    }
    for (let i = 0; i < k; i += 1) {
      const bucket = sums[i]
      if (bucket[3] === 0) continue
      centroids[i] = [
        Math.round(bucket[0] / bucket[3]),
        Math.round(bucket[1] / bucket[3]),
        Math.round(bucket[2] / bucket[3]),
      ]
    }
  }
  const weighted = centroids.map((centroid, index) => ({
    centroid,
    count: assignments.filter((item) => item === index).length,
  }))
  weighted.sort((a, b) => b.count - a.count)
  return weighted.filter((item) => item.count > 0).map((item) => item.centroid)
}

async function collectColorSamplesFromImages(images) {
  const samples = []
  for (const image of images) {
    if (!image?.src) continue
    const element = new Image()
    element.decoding = 'async'
    element.src = image.src
    try {
      await new Promise((resolve, reject) => {
        element.onload = resolve
        element.onerror = reject
      })
    } catch {
      // Ignore unsupported image and continue.
      continue
    }
    const naturalWidth = Math.max(1, element.naturalWidth || 1)
    const naturalHeight = Math.max(1, element.naturalHeight || 1)
    const scale = Math.min(1, PALETTE_SAMPLE_SIZE / Math.max(naturalWidth, naturalHeight))
    const width = Math.max(1, Math.round(naturalWidth * scale))
    const height = Math.max(1, Math.round(naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) continue
    ctx.drawImage(element, 0, 0, width, height)
    const { data } = ctx.getImageData(0, 0, width, height)
    const stride = data.length > 8000 ? 8 : 4
    for (let i = 0; i < data.length; i += stride) {
      const alpha = data[i + 3]
      if (alpha < 120) continue
      samples.push([data[i], data[i + 1], data[i + 2]])
      if (samples.length >= PALETTE_MAX_SAMPLES) return samples
    }
    await new Promise((resolve) => window.requestAnimationFrame(resolve))
  }
  return samples
}

async function extractPaletteColorsFromImages(images) {
  const samples = await collectColorSamplesFromImages(images)
  if (samples.length === 0) return []
  const k = clamp(Math.round(samples.length / 1200) + PALETTE_MIN_COLORS, PALETTE_MIN_COLORS, PALETTE_MAX_COLORS)
  const clustered = runKMeans(samples, k, 8)
  const deduped = dedupeColors(clustered, PALETTE_SIMILARITY_DELTA)
  return deduped.slice(0, PALETTE_MAX_COLORS).map((rgb) => rgbToHex(rgb[0], rgb[1], rgb[2]))
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

function serializePalettesForStorage(palettes) {
  return (Array.isArray(palettes) ? palettes : [])
    .map(normalizePaletteItem)
    .filter(Boolean)
    .map((palette) => ({
      id: palette.id,
      type: 'palette',
      x: palette.x,
      y: palette.y,
      colors: palette.colors,
      magneticGroupId: palette.magneticGroupId ?? null,
      createdFromGroupId: palette.createdFromGroupId ?? null,
      createdAt: palette.createdAt,
    }))
}

function serializeLinkThumbnailsForStorage(thumbnails) {
  return (Array.isArray(thumbnails) ? thumbnails : [])
    .map(normalizeLinkThumbnailItem)
    .filter(Boolean)
    .map((item) => ({
      id: item.id,
      type: 'link-thumbnail',
      x: item.x,
      y: item.y,
      href: item.href,
      imageUrl: item.imageUrl,
      ogImageUrl: item.ogImageUrl,
      screenshotUrl: item.screenshotUrl,
      title: item.title,
      domain: item.domain,
      siteName: item.siteName,
      thumbnailStatus: item.thumbnailStatus,
      thumbnailSource: item.thumbnailSource,
      thumbnailFetched: Boolean(item.thumbnailFetched),
      magneticGroupId: item.magneticGroupId ?? null,
      createdAt: item.createdAt,
    }))
}

function rehydrateBoardState(images, comments, palettes, linkThumbnails) {
  return {
    images: (Array.isArray(images) ? images : []).map(normalizeImageItem).filter(Boolean),
    comments: (Array.isArray(comments) ? comments : []).map(normalizeBoardComment).filter(Boolean),
    palettes: (Array.isArray(palettes) ? palettes : []).map(normalizePaletteItem).filter(Boolean),
    linkThumbnails: (Array.isArray(linkThumbnails) ? linkThumbnails : []).map(normalizeLinkThumbnailItem).filter(Boolean),
  }
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

function parseCanvasObjects(objects) {
  if (!Array.isArray(objects)) return { images: [], comments: [], palettes: [], linkThumbnails: [] }
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
    palettes: [],
    linkThumbnails: [],
  }
}

function parseBoardState(raw) {
  if (!raw) return { images: [], comments: [], palettes: [], linkThumbnails: [] }
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      const images = parsed.map(normalizeImageItem)
      const comments = deriveBoardCommentsFromImages(images).map(normalizeBoardComment).filter(Boolean)
      return rehydrateBoardState(images, comments, [], [])
    }
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.objects) && parsed.objects.length > 0) {
        const parsedObjects = parseCanvasObjects(parsed.objects)
        const fallbackImages = Array.isArray(parsed.images) ? parsed.images.map(normalizeImageItem).filter(Boolean) : []
        const fallbackComments = Array.isArray(parsed.comments)
          ? parsed.comments.map(normalizeBoardComment).filter(Boolean)
          : deriveBoardCommentsFromImages(fallbackImages).map(normalizeBoardComment).filter(Boolean)
        const fallbackPalettes = Array.isArray(parsed.palettes) ? parsed.palettes.map(normalizePaletteItem).filter(Boolean) : []
        const fallbackLinkThumbnails = Array.isArray(parsed.linkThumbnails)
          ? parsed.linkThumbnails.map(normalizeLinkThumbnailItem).filter(Boolean)
          : []
        const images = parsedObjects.images.length > 0 ? parsedObjects.images : fallbackImages
        const comments = parsedObjects.comments.length > 0 ? parsedObjects.comments : fallbackComments
        const palettes = parsedObjects.palettes.length > 0 ? parsedObjects.palettes : fallbackPalettes
        const linkThumbnails = parsedObjects.linkThumbnails.length > 0 ? parsedObjects.linkThumbnails : fallbackLinkThumbnails
        return rehydrateBoardState(images, comments, palettes, linkThumbnails)
      }
      const images = Array.isArray(parsed.images) ? parsed.images.map(normalizeImageItem) : []
      const comments = Array.isArray(parsed.comments)
        ? parsed.comments.map(normalizeBoardComment).filter(Boolean)
        : deriveBoardCommentsFromImages(images).map(normalizeBoardComment).filter(Boolean)
      const palettes = Array.isArray(parsed.palettes) ? parsed.palettes.map(normalizePaletteItem).filter(Boolean) : []
      const linkThumbnails = Array.isArray(parsed.linkThumbnails)
        ? parsed.linkThumbnails.map(normalizeLinkThumbnailItem).filter(Boolean)
        : []
      return rehydrateBoardState(images, comments, palettes, linkThumbnails)
    }
  } catch {
    return { images: [], comments: [], palettes: [], linkThumbnails: [] }
  }
  return { images: [], comments: [], palettes: [], linkThumbnails: [] }
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

function getPaletteSize(palette) {
  const count = Math.max(1, Array.isArray(palette?.colors) ? palette.colors.length : 0)
  const columns = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(count))))
  const swatchSize = 24
  const padding = 10
  const gap = 8
  const rows = Math.ceil(count / columns)
  const width = padding * 2 + columns * swatchSize + (columns - 1) * gap
  const height = padding * 2 + rows * swatchSize + (rows - 1) * gap
  return { width, height, columns, rows, swatchSize, gap, padding }
}

function getLinkThumbnailSize(item) {
  return {
    width: typeof item?.width === 'number' ? item.width : LINK_THUMBNAIL_DEFAULT_WIDTH,
    height: typeof item?.height === 'number' ? item.height : LINK_THUMBNAIL_DEFAULT_HEIGHT,
  }
}

function getBoundsFromLinkThumbnail(item, x = item.x, y = item.y) {
  const size = getLinkThumbnailSize(item)
  return {
    left: x,
    top: y,
    right: x + size.width,
    bottom: y + size.height,
    width: size.width,
    height: size.height,
  }
}

function sanitizeExternalUrl(raw) {
  if (typeof raw !== 'string') return null
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function sanitizeThumbnailImageUrl(raw) {
  if (typeof raw !== 'string') return ''
  const value = raw.trim()
  if (!value) return ''
  const lowered = value.toLowerCase()
  if (lowered.startsWith('data:') || lowered.startsWith('blob:') || lowered.startsWith('javascript:')) return ''
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return ''
    return url.toString()
  } catch {
    return ''
  }
}

function parseFirstUrlFromText(raw) {
  if (typeof raw !== 'string') return null
  const match = raw.match(/https?:\/\/[^\s<>"']+/i)
  if (!match) return null
  return sanitizeExternalUrl(match[0])
}

function isTransformableEntity(entity) {
  return entity?.isTransformable !== false
}

function getBoundsFromPalette(palette, x = palette.x, y = palette.y) {
  const size = getPaletteSize(palette)
  return {
    left: x,
    top: y,
    right: x + size.width,
    bottom: y + size.height,
    width: size.width,
    height: size.height,
  }
}

function getBoundsFromCanvasEntity(entity, naturalSize) {
  if (!entity) return null
  if (entity.type === 'palette') return getBoundsFromPalette(entity)
  const bounds = getRenderedImageBounds(entity, naturalSize)
  return {
    left: bounds.x,
    top: bounds.y,
    right: bounds.x + bounds.width,
    bottom: bounds.y + bounds.height,
    width: bounds.width,
    height: bounds.height,
  }
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

function getDraggedGroupBounds(images, palettes, linkThumbnails, draggedImageIds, draggedPaletteIds, draggedLinkIds, initialPositions, dx, dy) {
  const imageMap = new Map(images.map((image) => [image.id, image]))
  const paletteMap = new Map(palettes.map((palette) => [palette.id, palette]))
  const linkMap = new Map(linkThumbnails.map((item) => [item.id, item]))
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const id of draggedImageIds) {
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

  for (const id of draggedPaletteIds) {
    const palette = paletteMap.get(id)
    const start = initialPositions[id]
    if (!palette || !start) continue
    const size = getPaletteSize(palette)
    const left = start.x + dx
    const top = start.y + dy
    const right = left + size.width
    const bottom = top + size.height
    minX = Math.min(minX, left)
    minY = Math.min(minY, top)
    maxX = Math.max(maxX, right)
    maxY = Math.max(maxY, bottom)
  }
  for (const id of draggedLinkIds) {
    const item = linkMap.get(id)
    const start = initialPositions[id]
    if (!item || !start) continue
    const size = getLinkThumbnailSize(item)
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

function getMinEdgeDistance(a, b) {
  const leftGap = Math.abs(a.left - b.right)
  const rightGap = Math.abs(a.right - b.left)
  const topGap = Math.abs(a.top - b.bottom)
  const bottomGap = Math.abs(a.bottom - b.top)
  const horizontalGap =
    a.right < b.left ? rightGap
      : b.right < a.left ? leftGap
        : 0
  const verticalGap =
    a.bottom < b.top ? bottomGap
      : b.bottom < a.top ? topGap
        : 0
  return Math.hypot(horizontalGap, verticalGap)
}

function getPersistentGroupMemberIds(images, groupId) {
  if (!groupId) return []
  return images.filter((image) => image.magneticGroupId === groupId).map((image) => image.id)
}

function expandIdsWithPersistentGroups(ids, images) {
  const expanded = new Set(ids)
  for (const id of ids) {
    const image = images.find((entry) => entry.id === id)
    if (!image?.magneticGroupId) continue
    const members = getPersistentGroupMemberIds(images, image.magneticGroupId)
    for (const memberId of members) expanded.add(memberId)
  }
  return [...expanded]
}

function getSmartSnapResult(images, palettes, linkThumbnails, dragState, dx, dy, threshold = SMART_SNAP_THRESHOLD) {
  const draggedImageSet = new Set(dragState.draggedIds ?? [])
  const draggedPaletteIds = Object.keys(dragState.initialPalettePositions ?? {})
  const draggedLinkIds = Object.keys(dragState.initialLinkThumbnailPositions ?? {})
  const draggedPaletteSet = new Set(draggedPaletteIds)
  const draggedLinkSet = new Set(draggedLinkIds)
  const draggedBounds = getDraggedGroupBounds(
    images,
    palettes,
    linkThumbnails,
    [...draggedImageSet],
    draggedPaletteIds,
    draggedLinkIds,
    { ...dragState.initialPositions, ...(dragState.initialPalettePositions ?? {}), ...(dragState.initialLinkThumbnailPositions ?? {}) },
    dx,
    dy,
  )
  if (!draggedBounds) {
    return { dx, dy, guides: { vertical: null, horizontal: null } }
  }

  const draggedCenterX = (draggedBounds.minX + draggedBounds.maxX) / 2
  const draggedCenterY = (draggedBounds.minY + draggedBounds.maxY) / 2

  let bestX = null
  let bestY = null

  const targetEntities = [
    ...images.map((image) => {
      const size = getImageSize(image)
      return {
        id: image.id,
        type: 'image',
        left: image.x,
        top: image.y,
        right: image.x + size.width,
        bottom: image.y + size.height,
        centerX: image.x + size.width / 2,
        centerY: image.y + size.height / 2,
      }
    }),
    ...palettes.map((palette) => {
      const size = getPaletteSize(palette)
      return {
        id: palette.id,
        type: 'palette',
        left: palette.x,
        top: palette.y,
        right: palette.x + size.width,
        bottom: palette.y + size.height,
        centerX: palette.x + size.width / 2,
        centerY: palette.y + size.height / 2,
      }
    }),
    ...linkThumbnails.map((item) => {
      const size = getLinkThumbnailSize(item)
      return {
        id: item.id,
        type: 'link-thumbnail',
        left: item.x,
        top: item.y,
        right: item.x + size.width,
        bottom: item.y + size.height,
        centerX: item.x + size.width / 2,
        centerY: item.y + size.height / 2,
      }
    }),
  ]

  for (const targetBounds of targetEntities) {
    if (targetBounds.type === 'image' && draggedImageSet.has(targetBounds.id)) continue
    if (targetBounds.type === 'palette' && draggedPaletteSet.has(targetBounds.id)) continue
    if (targetBounds.type === 'link-thumbnail' && draggedLinkSet.has(targetBounds.id)) continue

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
  const adjustedBounds = getDraggedGroupBounds(
    images,
    palettes,
    linkThumbnails,
    [...draggedImageSet],
    draggedPaletteIds,
    draggedLinkIds,
    { ...dragState.initialPositions, ...(dragState.initialPalettePositions ?? {}), ...(dragState.initialLinkThumbnailPositions ?? {}) },
    nextDx,
    nextDy,
  )

  return {
    dx: nextDx,
    dy: nextDy,
    guides: {
      vertical:
        bestX && adjustedBounds
          ? {
              x: Math.round(bestX.target),
              top: Math.round(Math.min(adjustedBounds.minY, bestX.targetBounds.top)),
              bottom: Math.round(Math.max(adjustedBounds.maxY, bestX.targetBounds.bottom)),
            }
          : null,
      horizontal:
        bestY && adjustedBounds
          ? {
              y: Math.round(bestY.target),
              left: Math.round(Math.min(adjustedBounds.minX, bestY.targetBounds.left)),
              right: Math.round(Math.max(adjustedBounds.maxX, bestY.targetBounds.right)),
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

function getBoardStorageKey(boardId) {
  return `kanvaref:board:${boardId}`
}

export function Canvas() {
  const navigate = useNavigate()
  const { id: boardId } = useParams()
  const boardStorageKey = getBoardStorageKey(boardId)
  const legacyStorageKey = `curate-board-${boardId}`
  const snappingStorageKey = `curate-board-snap-${boardId}`
  const imageSnappingStorageKey = `curate-board-snap-images-${boardId}`

  const [images, setImages] = useState([])
  const [comments, setComments] = useState([])
  const [palettes, setPalettes] = useState([])
  const [linkThumbnails, setLinkThumbnails] = useState([])
  const [scale, setScale] = useState(1)
  const [offsetX, setOffsetX] = useState(0)
  const [offsetY, setOffsetY] = useState(0)
  const [selectedImageIds, setSelectedImageIds] = useState([])
  const [selectedPaletteIds, setSelectedPaletteIds] = useState([])
  const [selectedLinkThumbnailIds, setSelectedLinkThumbnailIds] = useState([])
  const [dragState, setDragState] = useState(null)
  const [paletteDragState, setPaletteDragState] = useState(null)
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
  const [isMagneticSnapEnabled, setIsMagneticSnapEnabled] = useState(false)
  const [magneticSnapLinkedIds, setMagneticSnapLinkedIds] = useState([])
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
  const [isExtractingPalette, setIsExtractingPalette] = useState(false)
  const [isAltDragHintVisible, setIsAltDragHintVisible] = useState(false)

  const canvasRef = useRef(null)
  const menuRef = useRef(null)
  const commentEditorRef = useRef(null)
  const commentInitialTextRef = useRef('')
  const commentSaveTimerRef = useRef(null)
  const suppressCommentPinClickRef = useRef(false)
  const lockFeedbackTimerRef = useRef(null)
  const altDragHintRef = useRef(null)
  const altDragHintRafRef = useRef(null)
  const altDragHintPosRef = useRef({ x: 0, y: 0 })
  const lockFeedbackLastAtRef = useRef(0)
  const scaleRef = useRef(scale)
  const offsetXRef = useRef(offsetX)
  const offsetYRef = useRef(offsetY)
  const imagesRef = useRef(images)
  const commentsRef = useRef(comments)
  const palettesRef = useRef(palettes)
  const linkThumbnailsRef = useRef(linkThumbnails)
  const selectedIdsRef = useRef(selectedImageIds)
  const selectedPaletteIdsRef = useRef(selectedPaletteIds)
  const selectedLinkThumbnailIdsRef = useRef(selectedLinkThumbnailIds)
  const linkMetadataCacheRef = useRef(new Map())
  const linkThumbnailTimeoutsRef = useRef(new Map())
  const linkPasteDebounceRef = useRef(null)
  const historyRef = useRef(history)
  const futureRef = useRef(future)
  const applyCropByRectRef = useRef(null)
  const previousImageSrcsRef = useRef(new Map())
  const persistCountRef = useRef(0)

  function resetBoardRuntimeState() {
    for (const timeoutId of linkThumbnailTimeoutsRef.current.values()) {
      clearTimeout(timeoutId)
    }
    linkThumbnailTimeoutsRef.current.clear()
    setImages([])
    setComments([])
    setPalettes([])
    setLinkThumbnails([])
    setSelectedImageIds([])
    setSelectedPaletteIds([])
    setSelectedLinkThumbnailIds([])
    setHistory([])
    setFuture([])
    setScale(1)
    setOffsetX(0)
    setOffsetY(0)
    setDragState(null)
    setPaletteDragState(null)
    setCommentDragState(null)
    setResizeState(null)
    setPanState(null)
    setMarqueeState(null)
    setMenuState(null)
    setIsSpaceDown(false)
    setCropMode(null)
    setCropInteraction(null)
    setIsQuickCropKeyDown(false)
    setQuickCropState(null)
    setIsCommentMode(false)
    setIsCanvasLocked(false)
    setIsMagneticSnapEnabled(false)
    setMagneticSnapLinkedIds([])
    setActiveCommentRef(null)
    setCommentDraft('')
    setCommentSaveState('idle')
    setSmartGuides({ vertical: null, horizontal: null })
    setPasteFeedback('')
    setLockFeedback('')
    setIsExtractingPalette(false)
    setIsAltDragHintVisible(false)
    setImageNaturalSizes({})

    imagesRef.current = []
    commentsRef.current = []
    palettesRef.current = []
    linkThumbnailsRef.current = []
    selectedIdsRef.current = []
    selectedPaletteIdsRef.current = []
    selectedLinkThumbnailIdsRef.current = []
    historyRef.current = []
    futureRef.current = []
    scaleRef.current = 1
    offsetXRef.current = 0
    offsetYRef.current = 0
    previousImageSrcsRef.current = new Map()
  }

  async function restoreBoard() {
    resetBoardRuntimeState()
    try {
      const saved = localStorage.getItem(boardStorageKey) || localStorage.getItem(legacyStorageKey) || null
      if (!saved) {
        console.log('[Curate] Initialized empty board', { storageKey: boardStorageKey })
        return
      }
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
      setPalettes(Array.isArray(parsed.palettes) ? parsed.palettes : [])
      setLinkThumbnails(Array.isArray(parsed.linkThumbnails) ? parsed.linkThumbnails : [])
      setImages(hydratedImages)
      console.log('[Curate] Hydrated board once', {
        imagesCount: hydratedImages.length,
        storageKey: boardStorageKey,
      })
    } catch (error) {
      console.error('[Curate] Failed to load board:', error)
    }
  }

  useEffect(() => {
    void restoreBoard()
  }, [boardStorageKey, legacyStorageKey])

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
    palettesRef.current = palettes
  }, [palettes])
  useEffect(() => {
    linkThumbnailsRef.current = linkThumbnails
  }, [linkThumbnails])
  useEffect(() => () => {
    for (const timeoutId of linkThumbnailTimeoutsRef.current.values()) {
      clearTimeout(timeoutId)
    }
    linkThumbnailTimeoutsRef.current.clear()
  }, [])
  useEffect(() => {
    const activeLoadingIds = new Set()
    for (const item of linkThumbnails) {
      if (item.thumbnailStatus !== 'loading' || !item.imageUrl) continue
      activeLoadingIds.add(item.id)
      if (linkThumbnailTimeoutsRef.current.has(item.id)) continue
      const timeoutId = setTimeout(() => {
        handleLinkThumbnailImageTimeout(item.id)
      }, LINK_THUMBNAIL_LOAD_TIMEOUT_MS)
      linkThumbnailTimeoutsRef.current.set(item.id, timeoutId)
    }
    for (const [id, timeoutId] of linkThumbnailTimeoutsRef.current.entries()) {
      if (activeLoadingIds.has(id)) continue
      clearTimeout(timeoutId)
      linkThumbnailTimeoutsRef.current.delete(id)
    }
  }, [linkThumbnails])
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
    selectedPaletteIdsRef.current = selectedPaletteIds
  }, [selectedPaletteIds])
  useEffect(() => {
    selectedLinkThumbnailIdsRef.current = selectedLinkThumbnailIds
  }, [selectedLinkThumbnailIds])
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
      if (altDragHintRafRef.current) window.cancelAnimationFrame(altDragHintRafRef.current)
    }
  }, [])

  function updateAltDragHintPosition(clientX, clientY) {
    altDragHintPosRef.current = { x: clientX + 12, y: clientY + 16 }
    if (altDragHintRafRef.current) return
    altDragHintRafRef.current = window.requestAnimationFrame(() => {
      altDragHintRafRef.current = null
      const node = altDragHintRef.current
      if (!node) return
      node.style.setProperty('--hint-x', `${altDragHintPosRef.current.x}px`)
      node.style.setProperty('--hint-y', `${altDragHintPosRef.current.y}px`)
    })
  }

  function hideAltDragHint() {
    setIsAltDragHintVisible(false)
  }

  function maybeShowAltDragHint(event, image) {
    if (!event || event.altKey) return
    if (!image?.magneticGroupId) return
    if (isCanvasLocked || cropMode || cropInteraction || resizeState) return
    const groupMemberCount = imagesRef.current.filter((entry) => entry.magneticGroupId === image.magneticGroupId).length
    if (groupMemberCount < 2) return
    try {
      if (localStorage.getItem(ALT_DRAG_HINT_STORAGE_KEY) === 'true') return
      localStorage.setItem(ALT_DRAG_HINT_STORAGE_KEY, 'true')
    } catch {
      // Ignore storage read/write issues for this non-critical hint.
    }
    updateAltDragHintPosition(event.clientX, event.clientY)
    setIsAltDragHintVisible(true)
  }

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
    setMagneticSnapLinkedIds((prev) => (prev.length > 0 ? [] : prev))
    hideAltDragHint()
  }, [dragState])

  useEffect(() => {
    try {
      const boardState = {
        images: serializeImagesForStorage(images),
        comments: serializeCommentsForStorage(comments),
        palettes: serializePalettesForStorage(palettes),
        linkThumbnails: serializeLinkThumbnailsForStorage(linkThumbnails),
      }
      persistCountRef.current += 1
      console.log('[Curate] Persisting board state', { persistCount: persistCountRef.current, imageCount: boardState.images.length })
      localStorage.setItem(
        boardStorageKey,
        JSON.stringify(boardState),
      )
      localStorage.setItem(
        legacyStorageKey,
        JSON.stringify(boardState),
      )
    } catch (error) {
      console.error('[Curate] Failed to persist board:', error)
    }
  }, [images, comments, palettes, linkThumbnails, boardStorageKey, legacyStorageKey])

  useEffect(() => {
    console.log('[Curate] Loaded board state', {
      imagesCount: images.length,
      storageKey: boardStorageKey,
    })
  }, [boardStorageKey, images.length])

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

  function commitHistory(
    previousImages,
    previousSelected,
    previousComments = commentsRef.current,
    previousPalettes = palettesRef.current,
    previousLinkThumbnails = linkThumbnailsRef.current,
  ) {
    // Called only for meaningful operations, so push this snapshot directly.
    setHistory((prev) => {
      const next = [...prev, {
        images: previousImages,
        comments: previousComments,
        palettes: previousPalettes,
        linkThumbnails: previousLinkThumbnails,
        selectedImageIds: previousSelected,
      }]
      return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
    })
    setFuture([])
  }

  function hasSnapshotChanged(snapshot) {
    if (!snapshot) return false
    return (
      JSON.stringify(snapshot.images) !== JSON.stringify(imagesRef.current) ||
      JSON.stringify(snapshot.comments ?? commentsRef.current) !== JSON.stringify(commentsRef.current) ||
      JSON.stringify(snapshot.palettes ?? palettesRef.current) !== JSON.stringify(palettesRef.current) ||
      JSON.stringify(snapshot.linkThumbnails ?? linkThumbnailsRef.current) !== JSON.stringify(linkThumbnailsRef.current) ||
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
      historySnapshot: {
        images: imagesRef.current,
        comments: commentsRef.current,
        palettes: palettesRef.current,
        linkThumbnails: linkThumbnailsRef.current,
        selectedImageIds: selectedIdsRef.current,
      },
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
    const currentState = {
      images: imagesRef.current,
      comments: commentsRef.current,
      palettes: palettesRef.current,
      linkThumbnails: linkThumbnailsRef.current,
      selectedImageIds: selectedIdsRef.current,
    }
    const nextHistory = prevHistory.slice(0, -1)
    const nextFuture = [...futureRef.current, currentState]
    const clampedFuture = nextFuture.length > HISTORY_LIMIT ? nextFuture.slice(nextFuture.length - HISTORY_LIMIT) : nextFuture
    historyRef.current = nextHistory
    futureRef.current = clampedFuture
    setHistory(nextHistory)
    setFuture(clampedFuture)
    setImages(previousState.images)
    setComments(previousState.comments ?? commentsRef.current)
    setPalettes(previousState.palettes ?? palettesRef.current)
    setLinkThumbnails(previousState.linkThumbnails ?? linkThumbnailsRef.current)
    setSelectedImageIds(previousState.selectedImageIds)
    setSelectedPaletteIds([])
    setSelectedLinkThumbnailIds([])
    setMenuState(null)
    return true
  }

  function redo() {
    const prevFuture = futureRef.current
    if (prevFuture.length === 0) return false
    const nextState = prevFuture[prevFuture.length - 1]
    const currentState = {
      images: imagesRef.current,
      comments: commentsRef.current,
      palettes: palettesRef.current,
      linkThumbnails: linkThumbnailsRef.current,
      selectedImageIds: selectedIdsRef.current,
    }
    const nextFuture = prevFuture.slice(0, -1)
    const nextHistory = [...historyRef.current, currentState]
    const clampedHistory = nextHistory.length > HISTORY_LIMIT ? nextHistory.slice(nextHistory.length - HISTORY_LIMIT) : nextHistory
    historyRef.current = clampedHistory
    futureRef.current = nextFuture
    setHistory(clampedHistory)
    setFuture(nextFuture)
    setImages(nextState.images)
    setComments(nextState.comments ?? commentsRef.current)
    setPalettes(nextState.palettes ?? palettesRef.current)
    setLinkThumbnails(nextState.linkThumbnails ?? linkThumbnailsRef.current)
    setSelectedImageIds(nextState.selectedImageIds)
    setSelectedPaletteIds([])
    setSelectedLinkThumbnailIds([])
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
    if (!isAltDragHintVisible) return
    function handleKeyDown(event) {
      if (event.key !== 'Alt') return
      hideAltDragHint()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isAltDragHintVisible])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('curate:toolbar-state', {
      detail: { isCommentMode, isCanvasLocked, isMagneticSnapEnabled },
    }))
  }, [isCommentMode, isCanvasLocked, isMagneticSnapEnabled])

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
      if (action === 'toggle-magnetic-snap') {
        setIsMagneticSnapEnabled((prev) => !prev)
        return
      }
      if (action === 'reset-view') {
        handleResetView()
      }
    }
    window.addEventListener('curate:toolbar-action', handleToolbarAction)
    return () => window.removeEventListener('curate:toolbar-action', handleToolbarAction)
  }, [isCommentMode, isCanvasLocked, isMagneticSnapEnabled, offsetX, offsetY, scale, images, palettes, linkThumbnails])

  function buildPaletteCopyText(colors, format) {
    if (!Array.isArray(colors) || colors.length === 0) return ''
    if (format === 'hex-vertical') return colors.join('\n')
    if (format === 'hex-comma') return colors.join(', ')
    if (format === 'css-vars') {
      return colors.map((color, index) => `--color-${index + 1}: ${color};`).join('\n')
    }
    if (format === 'tailwind') {
      const names = ['primary', 'secondary', 'accent', 'muted', 'surface', 'ink']
      const rows = colors.map((color, index) => `  ${names[index] || `color${index + 1}`}: "${color}",`)
      return `colors: {\n${rows.join('\n')}\n}`
    }
    if (format === 'json') {
      return JSON.stringify({ colors }, null, 2)
    }
    return colors.join('\n')
  }

  async function handleCopyPalette(format) {
    const paletteId = selectedPaletteIdsRef.current[0]
    if (!paletteId) return
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    const palette = palettesRef.current.find((entry) => entry.id === paletteId)
    if (!palette || !Array.isArray(palette.colors) || palette.colors.length === 0) return
    const text = buildPaletteCopyText(palette.colors, format)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setPasteFeedback('Palette copied')
      setMenuState(null)
    } catch {
      setPasteFeedback('Clipboard unavailable')
    }
  }

  function deleteSelectedCanvasItems() {
    const imageIds = selectedIdsRef.current
    const paletteIds = selectedPaletteIdsRef.current
    const linkIds = selectedLinkThumbnailIdsRef.current
    if (imageIds.length === 0 && paletteIds.length === 0 && linkIds.length === 0) return
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    const imageDeleteSet = new Set(imageIds)
    const paletteDeleteSet = new Set(paletteIds)
    const linkDeleteSet = new Set(linkIds)
    const prevImages = imagesRef.current
    const prevSelected = selectedIdsRef.current
    const prevComments = commentsRef.current
    const prevPalettes = palettesRef.current
    const prevLinkThumbnails = linkThumbnailsRef.current
    const imagesToDelete = prevImages.filter((image) => imageDeleteSet.has(image.id))
    setImages((prev) => prev.filter((image) => !imageDeleteSet.has(image.id)))
    setPalettes((prev) => prev.filter((palette) => !paletteDeleteSet.has(palette.id)))
    setLinkThumbnails((prev) => prev.filter((item) => !linkDeleteSet.has(item.id)))
    setSelectedImageIds([])
    setSelectedPaletteIds([])
    setSelectedLinkThumbnailIds([])
    setMenuState(null)
    commitHistory(prevImages, prevSelected, prevComments, prevPalettes, prevLinkThumbnails)
    void Promise.all(imagesToDelete.map((image) => deleteImageBlobById(image.id))).catch(() => {
      // Ignore blob cleanup failure; metadata removal is already complete.
    })
  }

  useEffect(() => {
    function handleDelete(event) {
      if (selectedImageIds.length === 0 && selectedPaletteIds.length === 0 && selectedLinkThumbnailIds.length === 0) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      deleteSelectedCanvasItems()
    }
    window.addEventListener('keydown', handleDelete)
    return () => window.removeEventListener('keydown', handleDelete)
  }, [canTransform, selectedImageIds, selectedPaletteIds, selectedLinkThumbnailIds])

  useEffect(() => {
    if (!isCanvasLocked) return
    if (!dragState && !paletteDragState && !resizeState && !panState && !marqueeState && !cropInteraction && !quickCropState && !cropMode) return
    setDragState(null)
    setPaletteDragState(null)
    setResizeState(null)
    setPanState(null)
    setMarqueeState(null)
    setCropInteraction(null)
    setQuickCropState(null)
    setCropMode(null)
    setSmartGuides({ vertical: null, horizontal: null })
    setMagneticSnapLinkedIds([])
  }, [isCanvasLocked, dragState, paletteDragState, resizeState, panState, marqueeState, cropInteraction, quickCropState, cropMode])

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

  function getScreenshotFallbackUrl(href) {
    return `https://image.thum.io/get/width/1200/noanimate/${encodeURIComponent(href)}`
  }

  function normalizeLinkMetadataEntry(href, value) {
    const normalizedHref = sanitizeExternalUrl(value?.href || href) || href
    const normalizedDomain =
      typeof value?.domain === 'string' && value.domain.trim()
        ? value.domain.trim()
        : new URL(normalizedHref).hostname.replace(/^www\./, '')
    return {
      href: normalizedHref,
      title: typeof value?.title === 'string' && value.title.trim() ? value.title.trim() : normalizedHref,
      domain: normalizedDomain,
      siteName: typeof value?.siteName === 'string' && value.siteName.trim() ? value.siteName.trim() : normalizedDomain,
      ogImageUrl: sanitizeThumbnailImageUrl(value?.ogImageUrl || value?.imageUrl),
      screenshotUrl: sanitizeThumbnailImageUrl(value?.screenshotUrl || getScreenshotFallbackUrl(normalizedHref)),
      ogFailed: Boolean(value?.ogFailed),
      screenshotFailed: Boolean(value?.screenshotFailed),
    }
  }

  function getInitialThumbnailCandidate(metadata) {
    const ogCandidate = metadata.ogFailed ? '' : sanitizeThumbnailImageUrl(metadata.ogImageUrl)
    if (ogCandidate) {
      return {
        imageUrl: ogCandidate,
        thumbnailSource: 'og',
        thumbnailStatus: 'loading',
      }
    }
    const screenshotCandidate = metadata.screenshotFailed ? '' : sanitizeThumbnailImageUrl(metadata.screenshotUrl)
    if (screenshotCandidate) {
      return {
        imageUrl: screenshotCandidate,
        thumbnailSource: 'screenshot',
        thumbnailStatus: 'loading',
      }
    }
    return {
      imageUrl: '',
      thumbnailSource: 'placeholder',
      thumbnailStatus: 'fallback',
    }
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LINK_METADATA_CACHE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return
      const next = new Map()
      for (const [href, data] of Object.entries(parsed)) {
        if (!sanitizeExternalUrl(href)) continue
        if (!data || typeof data !== 'object') continue
        next.set(href, normalizeLinkMetadataEntry(href, data))
      }
      linkMetadataCacheRef.current = next
    } catch {
      // Ignore invalid cached metadata.
    }
  }, [])

  function persistLinkMetadataCache() {
    try {
      const entries = Array.from(linkMetadataCacheRef.current.entries()).slice(-120)
      const payload = Object.fromEntries(entries)
      localStorage.setItem(LINK_METADATA_CACHE_KEY, JSON.stringify(payload))
    } catch {
      // Ignore cache persistence failures.
    }
  }

  function updateLinkMetadataEntry(href, updater) {
    const current = normalizeLinkMetadataEntry(href, linkMetadataCacheRef.current.get(href) || {})
    const next = normalizeLinkMetadataEntry(href, updater(current))
    linkMetadataCacheRef.current.set(href, next)
    persistLinkMetadataCache()
    return next
  }

  async function fetchLinkMetadata(href) {
    const cached = linkMetadataCacheRef.current.get(href)
    if (cached) return normalizeLinkMetadataEntry(href, cached)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), LINK_THUMBNAIL_LOAD_TIMEOUT_MS)
    const response = await fetch(`/api/link-metadata?url=${encodeURIComponent(href)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeoutId)
    })
    if (!response.ok) throw new Error('metadata fetch failed')
    const payload = await response.json()
    const normalized = normalizeLinkMetadataEntry(href, payload)
    linkMetadataCacheRef.current.set(href, normalized)
    persistLinkMetadataCache()
    return normalized
  }

  function clearLinkThumbnailLoadTimeout(id) {
    const timeoutId = linkThumbnailTimeoutsRef.current.get(id)
    if (!timeoutId) return
    clearTimeout(timeoutId)
    linkThumbnailTimeoutsRef.current.delete(id)
  }

  function handleLinkThumbnailImageLoad(id) {
    clearLinkThumbnailLoadTimeout(id)
    const current = linkThumbnailsRef.current.find((item) => item.id === id)
    if (!current) return
    if (current.thumbnailSource === 'og') {
      updateLinkMetadataEntry(current.href, (entry) => ({ ...entry, ogFailed: false }))
    } else if (current.thumbnailSource === 'screenshot') {
      updateLinkMetadataEntry(current.href, (entry) => ({ ...entry, screenshotFailed: false }))
    }
    setLinkThumbnails((prev) =>
      prev.map((item) => (item.id === id ? { ...item, thumbnailStatus: 'loaded' } : item)),
    )
  }

  function handleLinkThumbnailImageFailure(id, reason = 'error') {
    clearLinkThumbnailLoadTimeout(id)
    const current = linkThumbnailsRef.current.find((item) => item.id === id)
    if (!current || current.thumbnailStatus !== 'loading') return
    if (current.thumbnailSource === 'og') {
      const cached = updateLinkMetadataEntry(current.href, (entry) => ({ ...entry, ogFailed: true }))
      const screenshotCandidate =
        cached.screenshotFailed
          ? ''
          : sanitizeThumbnailImageUrl(current.screenshotUrl || cached.screenshotUrl)
      if (screenshotCandidate) {
        setLinkThumbnails((prev) =>
          prev.map((item) =>
            item.id === id
              ? {
                  ...item,
                  imageUrl: screenshotCandidate,
                  thumbnailSource: 'screenshot',
                  thumbnailStatus: 'loading',
                }
              : item,
          ),
        )
        return
      }
      setLinkThumbnails((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                imageUrl: '',
                thumbnailSource: 'placeholder',
                thumbnailStatus: 'fallback',
                title: item.title || item.domain || 'Preview unavailable',
              }
            : item,
        ),
      )
      return
    }

    if (current.thumbnailSource === 'screenshot') {
      updateLinkMetadataEntry(current.href, (entry) => ({ ...entry, screenshotFailed: true }))
    }
    setLinkThumbnails((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              imageUrl: '',
              thumbnailSource: 'placeholder',
              thumbnailStatus: reason === 'timeout' ? 'fallback' : 'error',
              title: item.title || item.domain || 'Preview unavailable',
            }
          : item,
      ),
    )
  }

  function handleLinkThumbnailImageTimeout(id) {
    handleLinkThumbnailImageFailure(id, 'timeout')
  }

  async function hydrateLinkThumbnailMetadata(id, href) {
    const current = linkThumbnailsRef.current.find((item) => item.id === id)
    if (!current || current.thumbnailFetched) return
    setLinkThumbnails((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              thumbnailFetched: true,
              thumbnailStatus: 'loading',
            }
          : item,
      ),
    )
    try {
      const metadata = await fetchLinkMetadata(href)
      const candidate = getInitialThumbnailCandidate(metadata)
      setLinkThumbnails((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                href: metadata.href,
                ogImageUrl: metadata.ogImageUrl,
                screenshotUrl: metadata.screenshotUrl,
                title: metadata.title,
                domain: metadata.domain,
                siteName: metadata.siteName || metadata.domain,
                imageUrl: candidate.imageUrl,
                thumbnailSource: candidate.thumbnailSource,
                thumbnailStatus: candidate.thumbnailStatus,
                thumbnailFetched: true,
              }
            : item,
        ),
      )
    } catch {
      setLinkThumbnails((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                thumbnailFetched: true,
                imageUrl: '',
                thumbnailSource: 'placeholder',
                thumbnailStatus: 'error',
                title: item.domain || 'Preview unavailable',
              }
            : item,
        ),
      )
    }
  }

  async function createLinkThumbnailFromUrl(href) {
    if (!canTransform) {
      showLockBlockedFeedback()
      return false
    }
    const center = getViewportCenterPoint()
    if (!center) return false
    const offset = pasteCount * PASTE_OFFSET_STEP
    const id = crypto.randomUUID()
    const placeholder = normalizeLinkThumbnailItem({
      id,
      href,
      x: center.x + offset,
      y: center.y + offset,
      imageUrl: '',
      title: 'Loading preview...',
      domain: new URL(href).hostname.replace(/^www\./, ''),
      siteName: '',
      ogImageUrl: '',
      screenshotUrl: getScreenshotFallbackUrl(href),
      thumbnailStatus: 'loading',
      thumbnailSource: 'placeholder',
      thumbnailFetched: false,
      magneticGroupId: null,
      createdAt: Date.now(),
    })
    if (!placeholder) return false
    const prevImages = imagesRef.current
    const prevSelected = selectedIdsRef.current
    const prevComments = commentsRef.current
    const prevPalettes = palettesRef.current
    const prevLinks = linkThumbnailsRef.current
    setLinkThumbnails((prev) => [...prev, placeholder])
    setSelectedImageIds([])
    setSelectedPaletteIds([])
    setSelectedLinkThumbnailIds([placeholder.id])
    setPasteCount((prev) => prev + 1)
    setMenuState(null)
    commitHistory(prevImages, prevSelected, prevComments, prevPalettes, prevLinks)
    void hydrateLinkThumbnailMetadata(placeholder.id, href)
    return true
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
  return localImages.map(({ id, src, dimensions }, index) => {
    const fitted = fitWithinMax(dimensions.width, dimensions.height)
    const image = makeImageItem(src, baseX + index * IMAGE_SPACING, baseY + index * IMAGE_SPACING, fitted.width, fitted.height)
    return { ...image, id }
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
    setSelectedPaletteIds([])
    setSelectedLinkThumbnailIds([])
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
    const pasted = items.map((item) => {
      return makeImageItem(item.src, startX + item.relX, startY + item.relY, item.width, item.height)
    })
    const prevImages = imagesRef.current
    const prevSelected = selectedIdsRef.current
    setImages((prev) => [...prev, ...pasted])
    setSelectedImageIds(pasted.map((image) => image.id))
    setSelectedPaletteIds([])
    setSelectedLinkThumbnailIds([])
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
      const pastedText = event.clipboardData?.getData('text/plain') || ''
      const pastedUrl = parseFirstUrlFromText(pastedText)
      if (pastedUrl) {
        event.preventDefault()
        if (linkPasteDebounceRef.current) window.clearTimeout(linkPasteDebounceRef.current)
        linkPasteDebounceRef.current = window.setTimeout(() => {
          void createLinkThumbnailFromUrl(pastedUrl)
          linkPasteDebounceRef.current = null
        }, 120)
        return
      }
      if (internalClipboard?.items?.length) {
        event.preventDefault()
        pasteFromInternalClipboard()
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => {
      window.removeEventListener('paste', handlePaste)
      if (linkPasteDebounceRef.current) {
        window.clearTimeout(linkPasteDebounceRef.current)
        linkPasteDebounceRef.current = null
      }
    }
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
    if (!window.isSecureContext || (!navigator.clipboard?.read && !navigator.clipboard?.readText)) return
    try {
      let hasSupportedImage = false
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read()
        hasSupportedImage = items.some((item) =>
          item.types.some((type) => PASTE_IMAGE_MIME_TYPES.has(type)),
        )
      }
      let hasUrl = false
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText()
        hasUrl = Boolean(parseFirstUrlFromText(text))
      }
      setIsPasteAvailable(hasInternal || hasSupportedImage || hasUrl)
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
      const prevImages = imagesRef.current
      const prevSelected = selectedIdsRef.current
      setImages((prev) => [...prev, pastedImage])
      setSelectedImageIds([pastedImage.id])
      setSelectedPaletteIds([])
      setSelectedLinkThumbnailIds([])
      setPasteCount((prev) => prev + 1)
      setMenuState(null)
      commitHistory(prevImages, prevSelected)
      return 'pasted'
    }
    if (pasteFromInternalClipboard()) return 'pasted'
    if (window.isSecureContext && navigator.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText()
        const pastedUrl = parseFirstUrlFromText(text)
        if (pastedUrl) {
          const created = await createLinkThumbnailFromUrl(pastedUrl)
          if (created) return 'pasted'
        }
      } catch {
        // Ignore clipboard text failure and fall through.
      }
    }
    if (clipboardResult.status === 'denied') return 'denied'
    if (clipboardResult.status === 'unsupported') return 'unsupported'
    return 'empty'
  }

  useEffect(() => {
    if (!dragState && !paletteDragState && !commentDragState && !panState && !resizeState && !marqueeState && !cropInteraction && !quickCropState) return
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
        if (isAltDragHintVisible) {
          updateAltDragHintPosition(event.clientX, event.clientY)
          const groupedDragStillActive = dragState.draggedIds.some((id) => {
            const current = imagesRef.current.find((entry) => entry.id === id)
            if (!current?.magneticGroupId) return false
            return imagesRef.current.filter((entry) => entry.magneticGroupId === current.magneticGroupId).length > 1
          })
          if (!groupedDragStillActive) hideAltDragHint()
        }
        if (event.altKey) hideAltDragHint()
        const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetX, offsetY, scale)
        let dx = pointer.x - dragState.startPointerX
        let dy = pointer.y - dragState.startPointerY
        let smartSnapGuides = { vertical: null, horizontal: null }
        if (isSnappingEnabled || isImageSnappingEnabled) {
          const primaryStart = dragState.initialPositions[dragState.primaryId]
          if (primaryStart) {
            let smartSnap = null
            if (isImageSnappingEnabled) {
              smartSnap = getSmartSnapResult(images, palettesRef.current, linkThumbnailsRef.current, dragState, dx, dy)
              dx = smartSnap.dx
              dy = smartSnap.dy
              smartSnapGuides = smartSnap.guides
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
        let linkedIds = []
        let persistentGroupAssignments = new Map()
        if (isMagneticSnapEnabled && !dragState.altOverride) {
          const snapshotImages = imagesRef.current
          const snapshotPalettes = palettesRef.current
          const snapshotLinks = linkThumbnailsRef.current
          const snapshotEntities = [
            ...snapshotImages.map((image) => ({ ...image, type: 'image', width: getImageSize(image).width, height: getImageSize(image).height })),
            ...snapshotPalettes.map((palette) => {
              const size = getPaletteSize(palette)
              return { ...palette, type: 'palette', width: size.width, height: size.height }
            }),
            ...snapshotLinks.map((item) => {
              const size = getLinkThumbnailSize(item)
              return { ...item, type: 'link-thumbnail', width: size.width, height: size.height }
            }),
          ]
          const draggedSet = new Set([
            ...movedIds,
            ...Object.keys(dragState.initialPalettePositions ?? {}),
            ...Object.keys(dragState.initialLinkThumbnailPositions ?? {}),
          ])
          const groupSet = new Set(draggedSet)
          const blockedLinkIds = new Set(dragState.blockedLinkIds ?? [])
          const blockedGroupIds = new Set(dragState.blockedGroupIds ?? [])
          const entitiesById = new Map(snapshotEntities.map((entity) => [entity.id, entity]))
          const primaryStart = dragState.initialAllPositions[dragState.primaryId]
          if (!primaryStart) return
          const draggedIds = [...draggedSet]

          function getPlannedGroupId(entityId) {
            if (persistentGroupAssignments.has(entityId)) return persistentGroupAssignments.get(entityId)
            return entitiesById.get(entityId)?.magneticGroupId ?? null
          }

          function getMembersForPersistentGroup(entityId) {
            const seedGroupId = getPlannedGroupId(entityId)
            if (!seedGroupId) return [entityId]
            const members = snapshotEntities
              .filter((entity) => getPlannedGroupId(entity.id) === seedGroupId)
              .map((entity) => entity.id)
            return members.length > 0 ? members : [entityId]
          }

          function getProjectedBounds(entityId, projectedDx = dx, projectedDy = dy) {
            const entity = entitiesById.get(entityId)
            if (!entity) return null
            if (draggedSet.has(entityId)) {
              const start = dragState.initialAllPositions[entityId]
              if (!start) return null
              if (entity.type === 'palette') {
                return getBoundsFromPalette(entity, start.x + projectedDx, start.y + projectedDy)
              }
              if (entity.type === 'link-thumbnail') {
                return getBoundsFromLinkThumbnail(entity, start.x + projectedDx, start.y + projectedDy)
              }
              return getBoundsFromImage(entity, start.x + projectedDx, start.y + projectedDy, entity.width, entity.height)
            }
            if (entity.type === 'palette') return getBoundsFromPalette(entity)
            if (entity.type === 'link-thumbnail') return getBoundsFromLinkThumbnail(entity)
            return getBoundsFromImage(entity, entity.x, entity.y, entity.width, entity.height)
          }

          const draggedBounds = getDraggedGroupBounds(
            snapshotImages,
            snapshotPalettes,
            linkThumbnailsRef.current,
            draggedIds,
            Object.keys(dragState.initialPalettePositions ?? {}),
            Object.keys(dragState.initialLinkThumbnailPositions ?? {}),
            { ...dragState.initialAllPositions, ...(dragState.initialPalettePositions ?? {}), ...(dragState.initialLinkThumbnailPositions ?? {}) },
            dx,
            dy,
          )
          if (draggedBounds) {
            let bestX = null
            let bestY = null
            for (const entity of snapshotEntities) {
              if (draggedSet.has(entity.id)) continue
              const candidateGroupId = getPlannedGroupId(entity.id)
              if (blockedLinkIds.has(entity.id) || (candidateGroupId && blockedGroupIds.has(candidateGroupId))) continue
              const target = getProjectedBounds(entity.id, dx, dy)
              if (!target) continue

              const xCandidates = [
                { delta: target.left - draggedBounds.maxX },
                { delta: target.right - draggedBounds.minX },
              ]
              for (const candidate of xCandidates) {
                const distance = Math.abs(candidate.delta)
                if (distance > MAGNETIC_SNAP_EDGE_THRESHOLD) continue
                if (!bestX || distance < bestX.distance) bestX = { ...candidate, distance }
              }

              const yCandidates = [
                { delta: target.top - draggedBounds.maxY },
                { delta: target.bottom - draggedBounds.minY },
              ]
              for (const candidate of yCandidates) {
                const distance = Math.abs(candidate.delta)
                if (distance > MAGNETIC_SNAP_EDGE_THRESHOLD) continue
                if (!bestY || distance < bestY.distance) bestY = { ...candidate, distance }
              }
            }
            if (bestX && !smartSnapGuides.vertical) dx += bestX.delta
            if (bestY && !smartSnapGuides.horizontal) dy += bestY.delta
          }

          for (const entity of snapshotEntities) {
            if (groupSet.has(entity.id)) continue
            const candidateGroupId = getPlannedGroupId(entity.id)
            if (blockedLinkIds.has(entity.id) || (candidateGroupId && blockedGroupIds.has(candidateGroupId))) continue
            const attachCandidateIds = getMembersForPersistentGroup(entity.id)
            let shouldAttach = false
            for (const candidateId of attachCandidateIds) {
              const candidateBounds = getProjectedBounds(candidateId, dx, dy)
              if (!candidateBounds) continue
              for (const memberId of draggedSet) {
                const memberBounds = getProjectedBounds(memberId, dx, dy)
                if (!memberBounds) continue
                if (getMinEdgeDistance(candidateBounds, memberBounds) <= MAGNETIC_SNAP_EDGE_THRESHOLD) {
                  shouldAttach = true
                  break
                }
              }
              if (shouldAttach) break
            }
            if (!shouldAttach) continue

            const existingGroupId =
              [...draggedSet].map((id) => getPlannedGroupId(id)).find((id) => typeof id === 'string' && id) ??
              attachCandidateIds.map((id) => getPlannedGroupId(id)).find((id) => typeof id === 'string' && id) ??
              crypto.randomUUID()
            for (const id of [...groupSet, ...attachCandidateIds]) {
              persistentGroupAssignments.set(id, existingGroupId)
              groupSet.add(id)
            }
          }

          linkedIds = [...groupSet].filter((id) => !draggedSet.has(id))
        }
        setMagneticSnapLinkedIds((prev) => {
          if (prev.length === linkedIds.length && prev.every((id, index) => id === linkedIds[index])) return prev
          return linkedIds
        })
        setImages((prev) =>
          prev.map((image) => {
            let nextImage = image
            const nextGroupId = persistentGroupAssignments.get(image.id)
            if (nextGroupId && nextImage.magneticGroupId !== nextGroupId) {
              nextImage = { ...nextImage, magneticGroupId: nextGroupId }
            }
            if (!movedIds.has(image.id)) return nextImage
            const start = dragState.initialAllPositions[image.id]
            if (!start) return nextImage
            return { ...nextImage, x: start.x + dx, y: start.y + dy }
          }),
        )
        setPalettes((prev) =>
          prev.map((palette) => {
            const nextGroupId = persistentGroupAssignments.get(palette.id)
            if (!nextGroupId || palette.magneticGroupId === nextGroupId) return palette
            return { ...palette, magneticGroupId: nextGroupId }
          }),
        )
        setLinkThumbnails((prev) =>
          prev.map((item) => {
            let nextItem = item
            const nextGroupId = persistentGroupAssignments.get(item.id)
            if (nextGroupId && nextItem.magneticGroupId !== nextGroupId) {
              nextItem = { ...nextItem, magneticGroupId: nextGroupId }
            }
            const start = dragState.initialLinkThumbnailPositions?.[item.id]
            if (!start) return nextItem
            return { ...nextItem, x: start.x + dx, y: start.y + dy }
          }),
        )
        if (dragState.initialPalettePositions && Object.keys(dragState.initialPalettePositions).length > 0) {
          setPalettes((prev) =>
            prev.map((palette) => {
              const start = dragState.initialPalettePositions[palette.id]
              if (!start) return palette
              return { ...palette, x: start.x + dx, y: start.y + dy }
            }),
          )
        }
        return
      }

      if (paletteDragState) {
        const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetX, offsetY, scale)
        let dx = pointer.x - paletteDragState.startPointerX
        let dy = pointer.y - paletteDragState.startPointerY
        if (isMagneticSnapEnabled && !paletteDragState.altOverride) {
          const draggedPaletteSet = new Set(Object.keys(paletteDragState.initialPalettePositions))
          const draggedImageSet = new Set(Object.keys(paletteDragState.initialImagePositions))
          const draggedLinkSet = new Set(Object.keys(paletteDragState.initialLinkThumbnailPositions ?? {}))
          let minX = Infinity
          let minY = Infinity
          let maxX = -Infinity
          let maxY = -Infinity
          for (const palette of palettesRef.current) {
            const start = paletteDragState.initialPalettePositions[palette.id]
            if (!start) continue
            const bounds = getBoundsFromPalette(palette, start.x + dx, start.y + dy)
            minX = Math.min(minX, bounds.left)
            minY = Math.min(minY, bounds.top)
            maxX = Math.max(maxX, bounds.right)
            maxY = Math.max(maxY, bounds.bottom)
          }
          for (const image of imagesRef.current) {
            const start = paletteDragState.initialImagePositions[image.id]
            if (!start) continue
            const size = getImageSize(image)
            const bounds = getBoundsFromImage(image, start.x + dx, start.y + dy, size.width, size.height)
            minX = Math.min(minX, bounds.left)
            minY = Math.min(minY, bounds.top)
            maxX = Math.max(maxX, bounds.right)
            maxY = Math.max(maxY, bounds.bottom)
          }
          for (const item of linkThumbnailsRef.current) {
            const start = paletteDragState.initialLinkThumbnailPositions?.[item.id]
            if (!start) continue
            const bounds = getBoundsFromLinkThumbnail(item, start.x + dx, start.y + dy)
            minX = Math.min(minX, bounds.left)
            minY = Math.min(minY, bounds.top)
            maxX = Math.max(maxX, bounds.right)
            maxY = Math.max(maxY, bounds.bottom)
          }
          if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
            let bestX = null
            let bestY = null
            for (const image of imagesRef.current) {
              if (draggedImageSet.has(image.id)) continue
              const target = getBoundsFromImage(image, image.x, image.y, getImageSize(image).width, getImageSize(image).height)
              const xCandidates = [{ delta: target.left - maxX }, { delta: target.right - minX }]
              for (const candidate of xCandidates) {
                const distance = Math.abs(candidate.delta)
                if (distance > MAGNETIC_SNAP_EDGE_THRESHOLD) continue
                if (!bestX || distance < bestX.distance) bestX = { ...candidate, distance }
              }
              const yCandidates = [{ delta: target.top - maxY }, { delta: target.bottom - minY }]
              for (const candidate of yCandidates) {
                const distance = Math.abs(candidate.delta)
                if (distance > MAGNETIC_SNAP_EDGE_THRESHOLD) continue
                if (!bestY || distance < bestY.distance) bestY = { ...candidate, distance }
              }
            }
            for (const palette of palettesRef.current) {
              if (draggedPaletteSet.has(palette.id)) continue
              const target = getBoundsFromPalette(palette)
              const xCandidates = [{ delta: target.left - maxX }, { delta: target.right - minX }]
              for (const candidate of xCandidates) {
                const distance = Math.abs(candidate.delta)
                if (distance > MAGNETIC_SNAP_EDGE_THRESHOLD) continue
                if (!bestX || distance < bestX.distance) bestX = { ...candidate, distance }
              }
              const yCandidates = [{ delta: target.top - maxY }, { delta: target.bottom - minY }]
              for (const candidate of yCandidates) {
                const distance = Math.abs(candidate.delta)
                if (distance > MAGNETIC_SNAP_EDGE_THRESHOLD) continue
                if (!bestY || distance < bestY.distance) bestY = { ...candidate, distance }
              }
            }
            for (const item of linkThumbnailsRef.current) {
              if (draggedLinkSet.has(item.id)) continue
              const target = getBoundsFromLinkThumbnail(item)
              const xCandidates = [{ delta: target.left - maxX }, { delta: target.right - minX }]
              for (const candidate of xCandidates) {
                const distance = Math.abs(candidate.delta)
                if (distance > MAGNETIC_SNAP_EDGE_THRESHOLD) continue
                if (!bestX || distance < bestX.distance) bestX = { ...candidate, distance }
              }
              const yCandidates = [{ delta: target.top - maxY }, { delta: target.bottom - minY }]
              for (const candidate of yCandidates) {
                const distance = Math.abs(candidate.delta)
                if (distance > MAGNETIC_SNAP_EDGE_THRESHOLD) continue
                if (!bestY || distance < bestY.distance) bestY = { ...candidate, distance }
              }
            }
            if (bestX) dx += bestX.delta
            if (bestY) dy += bestY.delta
          }
        }
        setPalettes((prev) =>
          prev.map((palette) => {
            const start = paletteDragState.initialPalettePositions[palette.id]
            if (!start) return palette
            return { ...palette, x: start.x + dx, y: start.y + dy }
          }),
        )
        if (paletteDragState.initialLinkThumbnailPositions && Object.keys(paletteDragState.initialLinkThumbnailPositions).length > 0) {
          setLinkThumbnails((prev) =>
            prev.map((item) => {
              const start = paletteDragState.initialLinkThumbnailPositions[item.id]
              if (!start) return item
              return { ...item, x: start.x + dx, y: start.y + dy }
            }),
          )
        }
        if (Object.keys(paletteDragState.initialImagePositions).length > 0) {
          setImages((prev) =>
            prev.map((image) => {
              const start = paletteDragState.initialImagePositions[image.id]
              if (!start) return image
              return { ...image, x: start.x + dx, y: start.y + dy }
            }),
          )
        }
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
            if (!marqueeState.appendToSelection) {
              setSelectedImageIds([])
              setSelectedPaletteIds([])
              setSelectedLinkThumbnailIds([])
            }
          } else {
            const topLeft = toCanvasPoint(left, top, rect, offsetX, offsetY, scale)
            const bottomRight = toCanvasPoint(right, bottom, rect, offsetX, offsetY, scale)
            const selectionRect = { left: topLeft.x, right: bottomRight.x, top: topLeft.y, bottom: bottomRight.y }
            const intersected = images.filter((image) => intersects(selectionRect, image)).map((image) => image.id)
            const intersectedPalettes = palettesRef.current
              .filter((palette) => intersects(selectionRect, { ...palette, ...getPaletteSize(palette) }))
              .map((palette) => palette.id)
            const intersectedLinks = linkThumbnailsRef.current
              .filter((item) => intersects(selectionRect, { ...item, ...getLinkThumbnailSize(item) }))
              .map((item) => item.id)
            setSelectedImageIds((prev) => (marqueeState.appendToSelection ? Array.from(new Set([...prev, ...intersected])) : intersected))
            setSelectedPaletteIds((prev) =>
              marqueeState.appendToSelection ? Array.from(new Set([...prev, ...intersectedPalettes])) : intersectedPalettes,
            )
            setSelectedLinkThumbnailIds((prev) =>
              marqueeState.appendToSelection ? Array.from(new Set([...prev, ...intersectedLinks])) : intersectedLinks,
            )
          }
        }
      }
      let didAltDetachUpdate = false
      let didPaletteGroupUpdate = false
      if (dragState?.altOverride) {
        const draggedSet = new Set(dragState.draggedIds)
        setImages((prev) => {
          const byId = new Map(prev.map((image) => [image.id, image]))
          const groupUpdates = new Map()
          if (!isMagneticSnapEnabled) {
            for (const imageId of draggedSet) groupUpdates.set(imageId, null)
          } else {
            for (const imageId of draggedSet) {
              const source = byId.get(imageId)
              if (!source) continue
              const sourceSize = getImageSize(source)
              const sourceBounds = getBoundsFromImage(source, source.x, source.y, sourceSize.width, sourceSize.height)
              let best = null
              for (const target of prev) {
                if (draggedSet.has(target.id)) continue
                const targetSize = getImageSize(target)
                const targetBounds = getBoundsFromImage(target, target.x, target.y, targetSize.width, targetSize.height)
                const distance = getMinEdgeDistance(sourceBounds, targetBounds)
                if (distance > MAGNETIC_SNAP_EDGE_THRESHOLD) continue
                if (!best || distance < best.distance) best = { targetId: target.id, distance }
              }
              if (!best) {
                groupUpdates.set(imageId, null)
                continue
              }
              const targetImage = byId.get(best.targetId)
              if (!targetImage) {
                groupUpdates.set(imageId, null)
                continue
              }
              const targetGroupId = targetImage.magneticGroupId || crypto.randomUUID()
              groupUpdates.set(best.targetId, targetGroupId)
              groupUpdates.set(imageId, targetGroupId)
            }
          }
          let didChange = false
          const next = prev.map((image) => {
            if (!groupUpdates.has(image.id)) return image
            const nextGroupId = groupUpdates.get(image.id)
            if ((image.magneticGroupId ?? null) === (nextGroupId ?? null)) return image
            didChange = true
            return { ...image, magneticGroupId: nextGroupId }
          })
          if (didChange) didAltDetachUpdate = true
          return didChange ? next : prev
        })
      }
      if (paletteDragState) {
        const draggedPaletteIds = new Set(paletteDragState.draggedPaletteIds ?? [])
        const draggedLinkIds = new Set(paletteDragState.draggedLinkThumbnailIds ?? [])
        if (paletteDragState.altOverride || !isMagneticSnapEnabled) {
          setPalettes((prev) => {
            let changed = false
            const next = prev.map((palette) => {
              if (!draggedPaletteIds.has(palette.id)) return palette
              if (!palette.magneticGroupId) return palette
              changed = true
              return { ...palette, magneticGroupId: null }
            })
            if (changed) didPaletteGroupUpdate = true
            return changed ? next : prev
          })
          setLinkThumbnails((prev) => {
            let changed = false
            const next = prev.map((item) => {
              if (!draggedLinkIds.has(item.id)) return item
              if (!item.magneticGroupId) return item
              changed = true
              return { ...item, magneticGroupId: null }
            })
            if (changed) didPaletteGroupUpdate = true
            return changed ? next : prev
          })
        } else {
          const imagesSnapshot = imagesRef.current
          const palettesSnapshot = palettesRef.current
          const linksSnapshot = linkThumbnailsRef.current
          const imageUpdates = new Map()
          const paletteUpdates = new Map()
          const linkUpdates = new Map()
          for (const palette of palettesSnapshot) {
            if (!draggedPaletteIds.has(palette.id)) continue
            const paletteBounds = getBoundsFromPalette(palette)
            let best = null
            for (const image of imagesSnapshot) {
              const imageBounds = getBoundsFromImage(image)
              const distance = getMinEdgeDistance(paletteBounds, imageBounds)
              if (distance > MAGNETIC_SNAP_EDGE_THRESHOLD) continue
              if (!best || distance < best.distance) best = { type: 'image', id: image.id, distance }
            }
            for (const candidatePalette of palettesSnapshot) {
              if (draggedPaletteIds.has(candidatePalette.id)) continue
              const candidateBounds = getBoundsFromPalette(candidatePalette)
              const distance = getMinEdgeDistance(paletteBounds, candidateBounds)
              if (distance > MAGNETIC_SNAP_EDGE_THRESHOLD) continue
              if (!best || distance < best.distance) best = { type: 'palette', id: candidatePalette.id, distance }
            }
            for (const linkItem of linksSnapshot) {
              if (draggedLinkIds.has(linkItem.id)) continue
              const candidateBounds = getBoundsFromLinkThumbnail(linkItem)
              const distance = getMinEdgeDistance(paletteBounds, candidateBounds)
              if (distance > MAGNETIC_SNAP_EDGE_THRESHOLD) continue
              if (!best || distance < best.distance) best = { type: 'link-thumbnail', id: linkItem.id, distance }
            }
            if (!best) continue
            const targetImage = best.type === 'image' ? imagesSnapshot.find((image) => image.id === best.id) : null
            const targetPalette = best.type === 'palette' ? palettesSnapshot.find((entry) => entry.id === best.id) : null
            const targetLink = best.type === 'link-thumbnail' ? linksSnapshot.find((entry) => entry.id === best.id) : null
            const groupId =
              targetImage?.magneticGroupId ||
              targetPalette?.magneticGroupId ||
              targetLink?.magneticGroupId ||
              palette.magneticGroupId ||
              crypto.randomUUID()
            if (targetImage) imageUpdates.set(targetImage.id, groupId)
            if (targetPalette) paletteUpdates.set(targetPalette.id, groupId)
            if (targetLink) linkUpdates.set(targetLink.id, groupId)
            paletteUpdates.set(palette.id, groupId)
          }
          for (const linkItem of linksSnapshot) {
            if (!draggedLinkIds.has(linkItem.id)) continue
            const linkBounds = getBoundsFromLinkThumbnail(linkItem)
            let best = null
            for (const image of imagesSnapshot) {
              const imageBounds = getBoundsFromImage(image)
              const distance = getMinEdgeDistance(linkBounds, imageBounds)
              if (distance > MAGNETIC_SNAP_EDGE_THRESHOLD) continue
              if (!best || distance < best.distance) best = { type: 'image', id: image.id, distance }
            }
            for (const palette of palettesSnapshot) {
              const paletteBounds = getBoundsFromPalette(palette)
              const distance = getMinEdgeDistance(linkBounds, paletteBounds)
              if (distance > MAGNETIC_SNAP_EDGE_THRESHOLD) continue
              if (!best || distance < best.distance) best = { type: 'palette', id: palette.id, distance }
            }
            for (const otherLink of linksSnapshot) {
              if (otherLink.id === linkItem.id || draggedLinkIds.has(otherLink.id)) continue
              const otherBounds = getBoundsFromLinkThumbnail(otherLink)
              const distance = getMinEdgeDistance(linkBounds, otherBounds)
              if (distance > MAGNETIC_SNAP_EDGE_THRESHOLD) continue
              if (!best || distance < best.distance) best = { type: 'link-thumbnail', id: otherLink.id, distance }
            }
            if (!best) continue
            const targetImage = best.type === 'image' ? imagesSnapshot.find((image) => image.id === best.id) : null
            const targetPalette = best.type === 'palette' ? palettesSnapshot.find((entry) => entry.id === best.id) : null
            const targetLink = best.type === 'link-thumbnail' ? linksSnapshot.find((entry) => entry.id === best.id) : null
            const groupId =
              targetImage?.magneticGroupId ||
              targetPalette?.magneticGroupId ||
              targetLink?.magneticGroupId ||
              linkItem.magneticGroupId ||
              crypto.randomUUID()
            if (targetImage) imageUpdates.set(targetImage.id, groupId)
            if (targetPalette) paletteUpdates.set(targetPalette.id, groupId)
            if (targetLink) linkUpdates.set(targetLink.id, groupId)
            linkUpdates.set(linkItem.id, groupId)
          }
          if (imageUpdates.size > 0) {
            setImages((prev) => {
              let changed = false
              const next = prev.map((image) => {
                const groupId = imageUpdates.get(image.id)
                if (!groupId || image.magneticGroupId === groupId) return image
                changed = true
                return { ...image, magneticGroupId: groupId }
              })
              if (changed) didPaletteGroupUpdate = true
              return changed ? next : prev
            })
          }
          if (paletteUpdates.size > 0) {
            setPalettes((prev) => {
              let changed = false
              const next = prev.map((palette) => {
                const groupId = paletteUpdates.get(palette.id)
                if (!groupId || palette.magneticGroupId === groupId) return palette
                changed = true
                return { ...palette, magneticGroupId: groupId }
              })
              if (changed) didPaletteGroupUpdate = true
              return changed ? next : prev
            })
          }
          if (linkUpdates.size > 0) {
            setLinkThumbnails((prev) => {
              let changed = false
              const next = prev.map((item) => {
                const groupId = linkUpdates.get(item.id)
                if (!groupId || item.magneticGroupId === groupId) return item
                changed = true
                return { ...item, magneticGroupId: groupId }
              })
              if (changed) didPaletteGroupUpdate = true
              return changed ? next : prev
            })
          }
        }
      }

      if (didAltDetachUpdate || hasSnapshotChanged(dragState?.historySnapshot)) {
        commitHistory(
          dragState.historySnapshot.images,
          dragState.historySnapshot.selectedImageIds,
          dragState.historySnapshot.comments,
          dragState.historySnapshot.palettes,
          dragState.historySnapshot.linkThumbnails,
        )
      }
      if (paletteDragState && (didPaletteGroupUpdate || hasSnapshotChanged(paletteDragState.historySnapshot))) {
        commitHistory(
          paletteDragState.historySnapshot.images,
          paletteDragState.historySnapshot.selectedImageIds,
          paletteDragState.historySnapshot.comments,
          paletteDragState.historySnapshot.palettes,
          paletteDragState.historySnapshot.linkThumbnails,
        )
      }
      if (hasSnapshotChanged(resizeState?.historySnapshot)) {
        commitHistory(
          resizeState.historySnapshot.images,
          resizeState.historySnapshot.selectedImageIds,
          resizeState.historySnapshot.comments,
          resizeState.historySnapshot.palettes,
        )
      }
      if (commentDragState && hasSnapshotChanged(commentDragState.historySnapshot)) {
        commitHistory(
          commentDragState.historySnapshot.images,
          commentDragState.historySnapshot.selectedImageIds,
          commentDragState.historySnapshot.comments,
          commentDragState.historySnapshot.palettes,
          commentDragState.historySnapshot.linkThumbnails,
        )
      }
      setDragState(null)
      setCommentDragState(null)
      setPaletteDragState(null)
      setSmartGuides({ vertical: null, horizontal: null })
      setPanState(null)
      setResizeState(null)
      setMarqueeState(null)
      hideAltDragHint()
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragState, paletteDragState, commentDragState, panState, resizeState, marqueeState, cropInteraction, cropMode, quickCropState, scale, offsetX, offsetY, images, isSnappingEnabled, isImageSnappingEnabled, isMagneticSnapEnabled, isCommentMode, isCanvasLocked, isAltDragHintVisible])

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
    setSelectedPaletteIds([])
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
    if (!canTransform) {
      setSelectedPaletteIds([])
      setSelectedLinkThumbnailIds([])
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
    const isAltOverride = event.altKey
    const baseDraggedIds = isAlreadySelected ? selectedImageIds : [image.id]
    const draggedIds = isAltOverride ? baseDraggedIds : expandIdsWithPersistentGroups(baseDraggedIds, images)
    if (!isAlreadySelected) setSelectedImageIds([image.id])
    setSelectedPaletteIds([])
    setSelectedLinkThumbnailIds([])
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetX, offsetY, scale)
    const initialPositions = {}
    const initialAllPositions = {}
    const initialPalettePositions = {}
    const initialLinkThumbnailPositions = {}
    const selectedPaletteSet = new Set(selectedPaletteIds)
    for (const currentImage of images) {
      initialAllPositions[currentImage.id] = { x: currentImage.x, y: currentImage.y }
      if (draggedIds.includes(currentImage.id)) initialPositions[currentImage.id] = { x: currentImage.x, y: currentImage.y }
    }
    for (const paletteEntry of palettes) {
      if (selectedPaletteSet.has(paletteEntry.id)) {
        initialPalettePositions[paletteEntry.id] = { x: paletteEntry.x, y: paletteEntry.y }
      }
    }
    const selectedLinkSet = new Set(selectedLinkThumbnailIds)
    for (const linkItem of linkThumbnails) {
      if (selectedLinkSet.has(linkItem.id)) {
        initialLinkThumbnailPositions[linkItem.id] = { x: linkItem.x, y: linkItem.y }
      }
    }
    if (!isAltOverride) {
      const draggedGroupIds = new Set(
        images
          .filter((entry) => draggedIds.includes(entry.id) && entry.magneticGroupId)
          .map((entry) => entry.magneticGroupId),
      )
      for (const paletteEntry of palettes) {
        if (!paletteEntry.magneticGroupId || !draggedGroupIds.has(paletteEntry.magneticGroupId)) continue
        initialPalettePositions[paletteEntry.id] = { x: paletteEntry.x, y: paletteEntry.y }
      }
      for (const linkItem of linkThumbnails) {
        if (!linkItem.magneticGroupId || !draggedGroupIds.has(linkItem.magneticGroupId)) continue
        initialLinkThumbnailPositions[linkItem.id] = { x: linkItem.x, y: linkItem.y }
      }
    }
    setDragState({
      primaryId: image.id,
      draggedIds,
      magneticGroupIds: draggedIds,
      startPointerX: pointer.x,
      startPointerY: pointer.y,
      initialPositions,
      initialAllPositions,
      initialPalettePositions,
      initialLinkThumbnailPositions,
      altOverride: isAltOverride,
      blockedLinkIds: [],
      blockedGroupIds: [],
      anchorOffsets: Object.fromEntries(
        draggedIds
          .map((id) => {
            const position = initialAllPositions[id]
            const primary = initialAllPositions[image.id]
            if (!position || !primary) return null
            return [id, { x: position.x - primary.x, y: position.y - primary.y }]
          })
          .filter(Boolean),
      ),
      historySnapshot: {
        images: imagesRef.current,
        comments: commentsRef.current,
        palettes: palettesRef.current,
        linkThumbnails: linkThumbnailsRef.current,
        selectedImageIds: selectedIdsRef.current,
      },
    })
    maybeShowAltDragHint(event, image)
  }

  function handlePaletteMouseDown(event, palette) {
    if (event.button !== 0) return
    if (cropMode || isCommentMode) return
    event.preventDefault()
    event.stopPropagation()
    setMenuState(null)
    if (event.shiftKey) {
      setSelectedPaletteIds((prev) => (prev.includes(palette.id) ? prev.filter((id) => id !== palette.id) : [...prev, palette.id]))
      return
    }
    const isAlreadySelected = selectedPaletteIds.includes(palette.id)
    if (!isAlreadySelected) {
      setSelectedImageIds([])
      setSelectedPaletteIds([palette.id])
      setSelectedLinkThumbnailIds([])
    }
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetX, offsetY, scale)
    const isAltOverride = event.altKey
    const linkedGroupId = !isAltOverride ? palette.magneticGroupId : null
    const basePaletteIds = isAlreadySelected ? selectedPaletteIds : [palette.id]
    const draggedPaletteIds = linkedGroupId
      ? Array.from(new Set([...basePaletteIds, ...palettes.filter((entry) => entry.magneticGroupId === linkedGroupId).map((entry) => entry.id)]))
      : basePaletteIds
    const initialPalettePositions = {}
    for (const currentPalette of palettes) {
      if (draggedPaletteIds.includes(currentPalette.id)) {
        initialPalettePositions[currentPalette.id] = { x: currentPalette.x, y: currentPalette.y }
      }
    }
    const initialImagePositions = {}
    const selectedImageSet = new Set(selectedImageIds)
    for (const image of images) {
      if (selectedImageSet.has(image.id)) {
        initialImagePositions[image.id] = { x: image.x, y: image.y }
        continue
      }
      if (!linkedGroupId || image.magneticGroupId !== linkedGroupId) continue
      initialImagePositions[image.id] = { x: image.x, y: image.y }
    }
    const initialLinkThumbnailPositions = {}
    for (const item of linkThumbnails) {
      if (selectedLinkThumbnailIds.includes(item.id)) {
        initialLinkThumbnailPositions[item.id] = { x: item.x, y: item.y }
        continue
      }
      if (!linkedGroupId || item.magneticGroupId !== linkedGroupId) continue
      initialLinkThumbnailPositions[item.id] = { x: item.x, y: item.y }
    }
    setPaletteDragState({
      paletteId: palette.id,
      draggedPaletteIds,
      altOverride: isAltOverride,
      startPointerX: pointer.x,
      startPointerY: pointer.y,
      initialPalettePositions,
      initialLinkThumbnailPositions,
      initialImagePositions,
      historySnapshot: {
        images: imagesRef.current,
        comments: commentsRef.current,
        palettes: palettesRef.current,
        linkThumbnails: linkThumbnailsRef.current,
        selectedImageIds: selectedIdsRef.current,
      },
    })
  }

  function handlePaletteContextMenu(event, palette) {
    event.preventDefault()
    event.stopPropagation()
    setSelectedImageIds([])
    setSelectedPaletteIds([palette.id])
    setSelectedLinkThumbnailIds([])
    setMenuState({ type: 'palette', x: event.clientX, y: event.clientY })
  }

  function openLinkThumbnail(item) {
    if (!item?.href) return
    window.open(item.href, '_blank', 'noopener,noreferrer')
  }

  function handleLinkThumbnailMouseDown(event, item) {
    if (event.button !== 0) return
    if (cropMode || isCommentMode) return
    event.preventDefault()
    event.stopPropagation()
    setMenuState(null)
    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      openLinkThumbnail(item)
      return
    }
    if (event.shiftKey) {
      setSelectedLinkThumbnailIds((prev) => (prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]))
      return
    }
    const isAlreadySelected = selectedLinkThumbnailIds.includes(item.id)
    if (!isAlreadySelected) {
      setSelectedImageIds([])
      setSelectedPaletteIds([])
      setSelectedLinkThumbnailIds([item.id])
    }
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetX, offsetY, scale)
    const isAltOverride = event.altKey
    const linkedGroupId = !isAltOverride ? item.magneticGroupId : null
    const baseIds = isAlreadySelected ? selectedLinkThumbnailIds : [item.id]
    const draggedLinkThumbnailIds = linkedGroupId
      ? Array.from(new Set([...baseIds, ...linkThumbnails.filter((entry) => entry.magneticGroupId === linkedGroupId).map((entry) => entry.id)]))
      : baseIds
    const initialLinkThumbnailPositions = {}
    for (const currentItem of linkThumbnails) {
      if (draggedLinkThumbnailIds.includes(currentItem.id)) {
        initialLinkThumbnailPositions[currentItem.id] = { x: currentItem.x, y: currentItem.y }
      }
    }
    const initialImagePositions = {}
    const selectedImageSet = new Set(selectedImageIds)
    for (const image of images) {
      if (selectedImageSet.has(image.id)) {
        initialImagePositions[image.id] = { x: image.x, y: image.y }
        continue
      }
      if (!linkedGroupId || image.magneticGroupId !== linkedGroupId) continue
      initialImagePositions[image.id] = { x: image.x, y: image.y }
    }
    const initialPalettePositions = {}
    for (const palette of palettes) {
      if (selectedPaletteIds.includes(palette.id)) {
        initialPalettePositions[palette.id] = { x: palette.x, y: palette.y }
        continue
      }
      if (!linkedGroupId || palette.magneticGroupId !== linkedGroupId) continue
      initialPalettePositions[palette.id] = { x: palette.x, y: palette.y }
    }
    setPaletteDragState({
      paletteId: null,
      draggedPaletteIds: Object.keys(initialPalettePositions),
      draggedLinkThumbnailIds,
      altOverride: isAltOverride,
      startPointerX: pointer.x,
      startPointerY: pointer.y,
      initialPalettePositions,
      initialLinkThumbnailPositions,
      initialImagePositions,
      historySnapshot: {
        images: imagesRef.current,
        comments: commentsRef.current,
        palettes: palettesRef.current,
        linkThumbnails: linkThumbnailsRef.current,
        selectedImageIds: selectedIdsRef.current,
      },
    })
  }

  function handleLinkThumbnailContextMenu(event, item) {
    event.preventDefault()
    event.stopPropagation()
    setSelectedImageIds([])
    setSelectedPaletteIds([])
    setSelectedLinkThumbnailIds([item.id])
    setMenuState({ type: 'link-thumbnail', x: event.clientX, y: event.clientY })
  }

  function handleResizeHandleMouseDown(event, entity, handle) {
    if (!isTransformableEntity(entity)) return
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    setMenuState(null)
    setSelectedPaletteIds([])
    setSelectedImageIds([entity.id])
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const pointer = toCanvasPoint(event.clientX, event.clientY, rect, offsetX, offsetY, scale)
    const renderedBounds = getRenderedImageBounds(entity, imageNaturalSizes[entity.id])
    setResizeState({
      id: entity.id,
      type: 'image',
      handle,
      startPointerX: pointer.x,
      startPointerY: pointer.y,
      startRect: renderedBounds,
      aspectRatio: Math.max(0.0001, renderedBounds.width / Math.max(renderedBounds.height, 0.0001)),
      historySnapshot: {
        images: imagesRef.current,
        comments: commentsRef.current,
        palettes: palettesRef.current,
        selectedImageIds: selectedIdsRef.current,
      },
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
    if (event.button === 0) {
      setSelectedPaletteIds([])
      setSelectedLinkThumbnailIds([])
    }
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
    if (selectedPaletteIds.length > 0) {
      setMenuState({ type: 'palette', x: event.clientX, y: event.clientY })
      return
    }
    if (selectedLinkThumbnailIds.length > 0) {
      setMenuState({ type: 'link-thumbnail', x: event.clientX, y: event.clientY })
      return
    }
    setMenuState({ type: 'canvas', x: event.clientX, y: event.clientY })
  }

  function getSelectedCanvasEntities() {
    const imageSet = new Set(selectedImageIds)
    const paletteSet = new Set(selectedPaletteIds)
    const linkSet = new Set(selectedLinkThumbnailIds)
    const selectedImages = images
      .filter((image) => imageSet.has(image.id))
      .map((image) => {
        const size = getImageSize(image)
        return { ...image, type: 'image', isTransformable: true, width: size.width, height: size.height }
      })
    const selectedPalettes = palettes
      .filter((palette) => paletteSet.has(palette.id))
      .map((palette) => {
        const size = getPaletteSize(palette)
        return { ...palette, type: 'palette', isTransformable: false, width: size.width, height: size.height }
      })
    const selectedLinks = linkThumbnails
      .filter((item) => linkSet.has(item.id))
      .map((item) => {
        const size = getLinkThumbnailSize(item)
        return { ...item, type: 'link-thumbnail', isTransformable: false, width: size.width, height: size.height }
      })
    return [...selectedImages, ...selectedPalettes, ...selectedLinks]
  }

  function applyEntityGeometryUpdates(byId) {
    if (!(byId instanceof Map) || byId.size === 0) return
    setImages((prev) =>
      prev.map((image) => {
        const next = byId.get(image.id)
        if (!next) return image
        return { ...image, x: next.x, y: next.y, width: next.width, height: next.height }
      }),
    )
    setPalettes((prev) =>
      prev.map((palette) => {
        const next = byId.get(palette.id)
        if (!next) return palette
        return { ...palette, x: next.x, y: next.y }
      }),
    )
    setLinkThumbnails((prev) =>
      prev.map((item) => {
        const next = byId.get(item.id)
        if (!next) return item
        return { ...item, x: next.x, y: next.y }
      }),
    )
  }

  function handleNormalizeHeight() {
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    const selected = getSelectedCanvasEntities().filter(isTransformableEntity)
    if (selected.length === 0) return
    const prevImages = imagesRef.current
    const prevSelected = selectedIdsRef.current
    const ordered = [...selected].sort((a, b) => a.y - b.y || a.x - b.x)
    const avgH = ordered.reduce((total, entity) => total + entity.height, 0) / ordered.length
    const minX = Math.min(...ordered.map((entity) => entity.x))
    const minY = Math.min(...ordered.map((entity) => entity.y))
    const maxX = Math.max(...ordered.map((entity) => entity.x + entity.width))
    const targetWidth = Math.max(maxX - minX, 800)
    const resized = ordered.map((entity) => {
      const ratio = entity.width / Math.max(entity.height, 0.0001)
      return { ...entity, width: Math.max(MIN_IMAGE_SIZE, ratio * avgH), height: Math.max(MIN_IMAGE_SIZE, avgH) }
    })
    const laidOut = packRows(resized, minX, minY, targetWidth, IMAGE_SPACING).map((entity) => ({
      ...entity,
      width: Math.max(MIN_IMAGE_SIZE, entity.width),
      height: Math.max(MIN_IMAGE_SIZE, entity.height),
    }))
    const byId = new Map(laidOut.map((entity) => [entity.id, entity]))
    applyEntityGeometryUpdates(byId)
    setMenuState(null)
    commitHistory(prevImages, prevSelected, commentsRef.current, palettesRef.current)
  }

  function handleNormalizeWidth() {
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    const selected = getSelectedCanvasEntities().filter(isTransformableEntity)
    if (selected.length === 0) return
    const prevImages = imagesRef.current
    const prevSelected = selectedIdsRef.current
    const ordered = [...selected].sort((a, b) => a.y - b.y || a.x - b.x)
    const avgW = ordered.reduce((total, entity) => total + entity.width, 0) / ordered.length
    const minX = Math.min(...ordered.map((entity) => entity.x))
    const minY = Math.min(...ordered.map((entity) => entity.y))
    const maxX = Math.max(...ordered.map((entity) => entity.x + entity.width))
    const targetWidth = Math.max(maxX - minX, 800)
    const resized = ordered.map((entity) => {
      const ratio = entity.height / Math.max(entity.width, 0.0001)
      return { ...entity, width: Math.max(MIN_IMAGE_SIZE, avgW), height: Math.max(MIN_IMAGE_SIZE, ratio * avgW) }
    })
    const laidOut = packRows(resized, minX, minY, targetWidth, IMAGE_SPACING).map((entity) => ({
      ...entity,
      width: Math.max(MIN_IMAGE_SIZE, entity.width),
      height: Math.max(MIN_IMAGE_SIZE, entity.height),
    }))
    const byId = new Map(laidOut.map((entity) => [entity.id, entity]))
    applyEntityGeometryUpdates(byId)
    setMenuState(null)
    commitHistory(prevImages, prevSelected, commentsRef.current, palettesRef.current)
  }

  function handleOptimizeLayout() {
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    const selected = getSelectedCanvasEntities()
    if (selected.length === 0) return
    const prevImages = imagesRef.current
    const prevSelected = selectedIdsRef.current
    const ordered = [...selected].sort((a, b) => a.y - b.y || a.x - b.x)
    const totalArea = ordered.reduce((total, entity) => total + entity.width * entity.height, 0)
    const targetRowWidth = Math.max(900, Math.sqrt(totalArea) * 1.7)
    const packed = packRows(ordered, 0, 0, targetRowWidth, IMAGE_SPACING)
    const originalMinX = Math.min(...ordered.map((entity) => entity.x))
    const originalMinY = Math.min(...ordered.map((entity) => entity.y))
    const minX = Math.min(...packed.map((entity) => entity.x))
    const minY = Math.min(...packed.map((entity) => entity.y))
    const optimized = packed.map((entity) => ({ ...entity, x: originalMinX + (entity.x - minX), y: originalMinY + (entity.y - minY) }))
    const byId = new Map(optimized.map((entity) => [entity.id, entity]))
    applyEntityGeometryUpdates(byId)
    setMenuState(null)
    commitHistory(prevImages, prevSelected, commentsRef.current, palettesRef.current)
  }

  function handleAlignSelected(mode) {
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    const selected = getSelectedCanvasEntities()
    if (selected.length < 2) return
    const prevImages = imagesRef.current
    const prevSelected = selectedIdsRef.current

    const selectedSet = new Set(selected.map((entity) => entity.id))
    const left = Math.min(...selected.map((entity) => entity.x))
    const top = Math.min(...selected.map((entity) => entity.y))
    const right = Math.max(...selected.map((entity) => entity.x + entity.width))
    const bottom = Math.max(...selected.map((entity) => entity.y + entity.height))
    const centerX = (left + right) / 2
    const centerY = (top + bottom) / 2

    const byId = new Map()
    for (const entity of selected) {
      let x = entity.x
      let y = entity.y
      if (mode === 'left') x = left
      if (mode === 'right') x = right - entity.width
      if (mode === 'top') y = top
      if (mode === 'bottom') y = bottom - entity.height
      if (mode === 'hcenter') x = centerX - entity.width / 2
      if (mode === 'vcenter') y = centerY - entity.height / 2
      byId.set(entity.id, { x, y, width: entity.width, height: entity.height })
    }
    applyEntityGeometryUpdates(byId)
    setMenuState(null)
    commitHistory(prevImages, prevSelected, commentsRef.current, palettesRef.current)
  }

  function getPaletteExtractionSourceImages() {
    const selected = images.filter((image) => selectedImageIds.includes(image.id))
    if (selected.length >= 2) return selected
    if (selected.length === 1) {
      const groupId = selected[0].magneticGroupId
      if (!groupId) return selected
      const grouped = images.filter((image) => image.magneticGroupId === groupId)
      return grouped.length > 1 ? grouped : selected
    }
    return []
  }

  async function handleExtractColorPalette() {
    if (!canTransform) {
      showLockBlockedFeedback()
      return
    }
    const sourceImages = getPaletteExtractionSourceImages()
    if (sourceImages.length === 0) return
    let loadingTimerId = null
    try {
      loadingTimerId = window.setTimeout(() => setIsExtractingPalette(true), 100)
      const colors = await extractPaletteColorsFromImages(sourceImages)
      if (colors.length === 0) {
        setPasteFeedback('No extractable colors found')
        setMenuState(null)
        return
      }
      const prevImages = imagesRef.current
      const prevSelected = selectedIdsRef.current
      const prevComments = commentsRef.current
      const prevPalettes = palettesRef.current
      const left = Math.min(...sourceImages.map((image) => image.x))
      const top = Math.min(...sourceImages.map((image) => image.y))
      const right = Math.max(...sourceImages.map((image) => image.x + getImageSize(image).width))
      const paletteId = crypto.randomUUID()
      const createdFromGroupId =
        sourceImages.length === 1
          ? (sourceImages[0].magneticGroupId ?? null)
          : (() => {
              const ids = [...new Set(sourceImages.map((image) => image.magneticGroupId).filter(Boolean))]
              return ids.length === 1 ? ids[0] : null
            })()
      const singleSourceImage = sourceImages.length === 1 ? sourceImages[0] : null
      const palette = normalizePaletteItem({
        id: paletteId,
        x: singleSourceImage ? singleSourceImage.x + 24 : right + 28,
        y: singleSourceImage ? singleSourceImage.y + 24 : top,
        colors,
        createdFromGroupId,
        magneticGroupId: null,
        createdAt: Date.now(),
      })
      if (!palette) return
      setPalettes((prev) => [...prev, palette])
      setSelectedImageIds([])
      setSelectedPaletteIds([palette.id])
      setMenuState(null)
      commitHistory(prevImages, prevSelected, prevComments, prevPalettes)
      setPasteFeedback('Color palette created')
      if (left > palette.x) setOffsetX(offsetXRef.current + (left - palette.x))
    } finally {
      if (loadingTimerId !== null) window.clearTimeout(loadingTimerId)
      setIsExtractingPalette(false)
    }
  }

  async function handlePaletteSwatchClick(event, hex) {
    event.preventDefault()
    event.stopPropagation()
    try {
      await navigator.clipboard.writeText(hex)
      setPasteFeedback(`${hex} copied`)
    } catch {
      setPasteFeedback('Clipboard unavailable')
    }
  }

  function handleCreateNewBoard() {
    window.open(`/board/${generateBoardId()}`, '_blank', 'noopener,noreferrer')
    setMenuState(null)
  }

  function handleDeleteBoard() {
    const confirmed = window.confirm('Delete this board? This action cannot be undone.')
    if (!confirmed) return
    localStorage.removeItem(boardStorageKey)
    localStorage.removeItem(legacyStorageKey)
    localStorage.removeItem(snappingStorageKey)
    localStorage.removeItem(imageSnappingStorageKey)
    setImages([])
    setComments([])
    setPalettes([])
    setLinkThumbnails([])
    setSelectedImageIds([])
    setSelectedPaletteIds([])
    setSelectedLinkThumbnailIds([])
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
    if (images.length === 0 && palettes.length === 0 && linkThumbnails.length === 0) {
      setOffsetX(rect.width / 2)
      setOffsetY(rect.height / 2)
      return
    }
    const imageRects = images.map((image) => ({ x: image.x, y: image.y, width: getImageSize(image).width, height: getImageSize(image).height }))
    const paletteRects = palettes.map((palette) => {
      const size = getPaletteSize(palette)
      return { x: palette.x, y: palette.y, width: size.width, height: size.height }
    })
    const linkRects = linkThumbnails.map((item) => {
      const size = getLinkThumbnailSize(item)
      return { x: item.x, y: item.y, width: size.width, height: size.height }
    })
    const allRects = [...imageRects, ...paletteRects, ...linkRects]
    const minX = Math.min(...allRects.map((item) => item.x))
    const minY = Math.min(...allRects.map((item) => item.y))
    const maxX = Math.max(...allRects.map((item) => item.x + item.width))
    const maxY = Math.max(...allRects.map((item) => item.y + item.height))
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
        palettes: palettesRef.current,
        linkThumbnails: linkThumbnailsRef.current,
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
  const selectedPalette = selectedPaletteIds.length === 1 ? palettes.find((palette) => palette.id === selectedPaletteIds[0]) ?? null : null
  const selectedLinkThumbnail =
    selectedLinkThumbnailIds.length === 1
      ? linkThumbnails.find((item) => item.id === selectedLinkThumbnailIds[0]) ?? null
      : null
  const singleSelectedEntity =
    selectedImageIds.length + selectedPaletteIds.length + selectedLinkThumbnailIds.length === 1
      ? (selectedImage ?? selectedPalette ?? selectedLinkThumbnail)
      : null
  const singleSelectedTransformableEntity = singleSelectedEntity && isTransformableEntity(singleSelectedEntity) ? singleSelectedEntity : null
  const selectedEntityCount = selectedImageIds.length + selectedPaletteIds.length + selectedLinkThumbnailIds.length
  const selectedRenderedBounds = singleSelectedEntity
    ? (singleSelectedEntity.type === 'palette'
      ? (() => {
          const b = getBoundsFromPalette(singleSelectedEntity)
          return { x: b.left, y: b.top, width: b.width, height: b.height }
        })()
      : getRenderedImageBounds(singleSelectedEntity, imageNaturalSizes[singleSelectedEntity.id]))
    : null
  const selectedImageOutlines = images
    .filter((image) => selectedImageIds.includes(image.id) && isTransformableEntity(image))
    .map((image) => ({
      id: image.id,
      bounds: getRenderedImageBounds(image, imageNaturalSizes[image.id]),
    }))
  const resizeHandleDefs = singleSelectedTransformableEntity && selectedRenderedBounds
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
  const canResetSelectedImageCropTransform =
    selectedImage && selectedPaletteIds.length === 0 && selectedLinkThumbnailIds.length === 0 ? canResetCropOrTransform(selectedImage) : false
  const canDeleteSelection = !isCanvasLocked && (selectedImageIds.length > 0 || selectedPaletteIds.length > 0 || selectedLinkThumbnailIds.length > 0)
  const canCopySelectedPalette = !isCanvasLocked && Boolean(selectedPalette)
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
  const paletteSourceImages = getPaletteExtractionSourceImages()
  const canExtractPalette = !isCanvasLocked && !isExtractingPalette && paletteSourceImages.length > 0
  const hasImages = images.length > 0
  const hasCanvasItems = images.length > 0 || palettes.length > 0 || linkThumbnails.length > 0
  const shouldShowWorldOrigin = scale < 1.2 || !hasCanvasItems
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
      className={`canvas-viewport ${isQuickCropKeyDown && !cropMode ? 'is-crop-key-held' : ''} ${isCommentMode ? 'is-comment-mode' : ''} ${isCanvasLocked ? 'is-locked' : ''} ${isSpaceDown && canPan && !cropMode && !quickCropState ? 'is-space-pan-ready' : ''} ${panState ? 'is-panning' : ''}`}
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
          {palettes.map((palette) => {
            const size = getPaletteSize(palette)
            return (
              <div
                key={palette.id}
                className={`canvas-palette-node ${selectedPaletteIds.includes(palette.id) ? 'is-selected' : ''}`.trim()}
                style={{
                  left: `${palette.x}px`,
                  top: `${palette.y}px`,
                  width: `${size.width}px`,
                  height: `${size.height}px`,
                  gridTemplateColumns: `repeat(${size.columns}, ${size.swatchSize}px)`,
                }}
                onMouseDown={(event) => handlePaletteMouseDown(event, palette)}
                onContextMenu={(event) => handlePaletteContextMenu(event, palette)}
              >
                {palette.colors.map((color) => (
                  <button
                    key={`${palette.id}-${color}`}
                    type="button"
                    className="canvas-palette-swatch"
                    style={{ backgroundColor: color, width: `${size.swatchSize}px`, height: `${size.swatchSize}px` }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => void handlePaletteSwatchClick(event, color)}
                    title={color}
                    aria-label={`Copy ${color}`}
                  />
                ))}
              </div>
            )
          })}
          {linkThumbnails.map((item) => {
            const size = getLinkThumbnailSize(item)
            const isSelected = selectedLinkThumbnailIds.includes(item.id)
            const showsImage = Boolean(item.imageUrl) && (item.thumbnailStatus === 'loading' || item.thumbnailStatus === 'loaded')
            const showsSkeleton = item.thumbnailStatus === 'loading'
            const showsPlaceholder = item.thumbnailStatus === 'fallback' || item.thumbnailStatus === 'error'
            return (
              <article
                key={item.id}
                className={`canvas-link-thumbnail ${isSelected ? 'is-selected' : ''}`.trim()}
                style={{
                  left: `${item.x}px`,
                  top: `${item.y}px`,
                  width: `${size.width}px`,
                  height: `${size.height}px`,
                }}
                onMouseDown={(event) => handleLinkThumbnailMouseDown(event, item)}
                onDoubleClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  openLinkThumbnail(item)
                }}
                onContextMenu={(event) => handleLinkThumbnailContextMenu(event, item)}
                title={item.href}
              >
                <span className="canvas-link-thumbnail__arrow" aria-hidden="true">
                  <ExternalLink size={13} strokeWidth={ICON_STROKE_WIDTH} />
                </span>
                <div className={`canvas-link-thumbnail__media ${showsPlaceholder ? 'is-fallback' : ''}`.trim()}>
                  {showsImage
                    ? (
                      <img
                        src={item.imageUrl}
                        alt=""
                        className="canvas-link-thumbnail__image"
                        draggable={false}
                        onLoad={() => handleLinkThumbnailImageLoad(item.id)}
                        onError={() => handleLinkThumbnailImageFailure(item.id)}
                      />
                    )
                    : null}
                  {showsSkeleton ? <div className="canvas-link-thumbnail__skeleton" /> : null}
                  {showsPlaceholder
                    ? (
                      <div className="canvas-link-thumbnail__placeholder">
                        <div className="canvas-link-thumbnail__placeholder-domain">{item.domain}</div>
                      </div>
                    )
                    : null}
                </div>
                <div className="canvas-link-thumbnail__body">
                  <div className="canvas-link-thumbnail__title">{item.title || item.domain}</div>
                  <div className="canvas-link-thumbnail__domain">{item.domain}</div>
                </div>
              </article>
            )
          })}
          {images.map((image) => {
            const size = getImageSize(image)
            const renderSrc = getRenderableImageSrc(image.src)
            return (
              <div
                key={image.id}
                data-image-id={image.id}
                className={`canvas-image-node ${magneticSnapLinkedIds.includes(image.id) ? 'is-magnetic-linked' : ''}`.trim()}
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
          {selectedImageOutlines.map((outline) => (
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
          {singleSelectedTransformableEntity ? resizeHandleDefs.map((handleDef) => (
            <button
              key={handleDef.handle}
              type="button"
              className={`canvas-resize-handle is-${handleDef.handle}`.trim()}
              style={{ left: `${handleDef.x}px`, top: `${handleDef.y}px` }}
              onMouseDown={(event) => handleResizeHandleMouseDown(event, singleSelectedTransformableEntity, handleDef.handle)}
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
                className={`canvas-menu-item ${selectedImageIds.length === 1 && selectedPaletteIds.length === 0 ? '' : 'is-disabled'}`.trim()}
                onClick={() => enterCropMode(selectedImageIds[0])}
                disabled={selectedImageIds.length !== 1 || selectedPaletteIds.length > 0}
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
              <button
                type="button"
                className={`canvas-menu-item ${canExtractPalette ? '' : 'is-disabled'}`.trim()}
                onClick={handleExtractColorPalette}
                disabled={!canExtractPalette}
              >
                <MenuIcon>
                  <LayoutGrid size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">{isExtractingPalette ? 'Extracting color palette...' : 'Extract Color Palette'}</span>
              </button>
              {selectedImageIds.length === 1 && selectedPaletteIds.length === 0 && canResetSelectedImageCropTransform ? (
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
              {selectedEntityCount >= 2 ? (
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
              <div className="canvas-context-menu__divider" />
              <button
                type="button"
                className={`canvas-menu-item is-danger ${canDeleteSelection ? '' : 'is-disabled'}`.trim()}
                onClick={deleteSelectedCanvasItems}
                disabled={!canDeleteSelection}
              >
                <MenuIcon>
                  <Trash2 size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">{selectedImageIds.length > 1 ? 'Delete Selected' : 'Delete'}</span>
              </button>
            </>
          ) : menuState.type === 'palette' ? (
            <>
              <button type="button" className="canvas-menu-item" onClick={handleOptimizeLayout}>
                <MenuIcon>
                  <LayoutGrid size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">Optimize layout</span>
              </button>
              {selectedEntityCount >= 2 ? (
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
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('left')}><MenuIcon><AlignLeft size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon><span className="canvas-menu-item__label">Align Left</span></button>
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('right')}><MenuIcon><AlignRight size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon><span className="canvas-menu-item__label">Align Right</span></button>
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('top')}><MenuIcon><AlignTop size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon><span className="canvas-menu-item__label">Align Top</span></button>
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('bottom')}><MenuIcon><AlignBottom size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon><span className="canvas-menu-item__label">Align Bottom</span></button>
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('hcenter')}><MenuIcon><AlignCenterHorizontal size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon><span className="canvas-menu-item__label">Align Horizontal Center</span></button>
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('vcenter')}><MenuIcon><AlignCenterVertical size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon><span className="canvas-menu-item__label">Align Vertical Center</span></button>
                    </div>
                  </div>
                </>
              ) : null}
              <div className="canvas-context-menu__divider" />
              <div className="canvas-menu-submenu">
                <button type="button" className="canvas-menu-item canvas-menu-submenu__trigger">
                  <MenuIcon>
                    <LayoutGrid size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                  </MenuIcon>
                  <span className="canvas-menu-item__label">Color Palette</span>
                  <span className="canvas-menu-submenu__chevron" aria-hidden="true"><ChevronRight size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></span>
                </button>
                <div className="canvas-menu-submenu__panel">
                  <button
                    type="button"
                    className={`canvas-menu-item ${canCopySelectedPalette ? '' : 'is-disabled'}`.trim()}
                    onClick={() => void handleCopyPalette('hex-vertical')}
                    disabled={!canCopySelectedPalette}
                  >
                    <MenuIcon><Clipboard size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon>
                    <span className="canvas-menu-item__label">Copy as HEX (vertical list)</span>
                  </button>
                  <button
                    type="button"
                    className={`canvas-menu-item ${canCopySelectedPalette ? '' : 'is-disabled'}`.trim()}
                    onClick={() => void handleCopyPalette('hex-comma')}
                    disabled={!canCopySelectedPalette}
                  >
                    <MenuIcon><Clipboard size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon>
                    <span className="canvas-menu-item__label">Copy as HEX (comma-separated)</span>
                  </button>
                  <button
                    type="button"
                    className={`canvas-menu-item ${canCopySelectedPalette ? '' : 'is-disabled'}`.trim()}
                    onClick={() => void handleCopyPalette('css-vars')}
                    disabled={!canCopySelectedPalette}
                  >
                    <MenuIcon><Clipboard size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon>
                    <span className="canvas-menu-item__label">Copy as CSS variables</span>
                  </button>
                  <button
                    type="button"
                    className={`canvas-menu-item ${canCopySelectedPalette ? '' : 'is-disabled'}`.trim()}
                    onClick={() => void handleCopyPalette('tailwind')}
                    disabled={!canCopySelectedPalette}
                  >
                    <MenuIcon><Clipboard size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon>
                    <span className="canvas-menu-item__label">Copy as Tailwind config</span>
                  </button>
                  <button
                    type="button"
                    className={`canvas-menu-item ${canCopySelectedPalette ? '' : 'is-disabled'}`.trim()}
                    onClick={() => void handleCopyPalette('json')}
                    disabled={!canCopySelectedPalette}
                  >
                    <MenuIcon><Clipboard size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon>
                    <span className="canvas-menu-item__label">Copy as JSON</span>
                  </button>
                  <div className="canvas-context-menu__divider" />
                  <button
                    type="button"
                    className={`canvas-menu-item is-danger ${canDeleteSelection ? '' : 'is-disabled'}`.trim()}
                    onClick={deleteSelectedCanvasItems}
                    disabled={!canDeleteSelection}
                  >
                    <MenuIcon>
                      <Trash2 size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                    </MenuIcon>
                    <span className="canvas-menu-item__label">Delete Palette</span>
                  </button>
                </div>
              </div>
            </>
          ) : menuState.type === 'link-thumbnail' ? (
            <>
              <button type="button" className="canvas-menu-item" onClick={handleOptimizeLayout}>
                <MenuIcon>
                  <LayoutGrid size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">Optimize layout</span>
              </button>
              {selectedEntityCount >= 2 ? (
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
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('left')}><MenuIcon><AlignLeft size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon><span className="canvas-menu-item__label">Align Left</span></button>
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('right')}><MenuIcon><AlignRight size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon><span className="canvas-menu-item__label">Align Right</span></button>
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('top')}><MenuIcon><AlignTop size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon><span className="canvas-menu-item__label">Align Top</span></button>
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('bottom')}><MenuIcon><AlignBottom size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon><span className="canvas-menu-item__label">Align Bottom</span></button>
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('hcenter')}><MenuIcon><AlignCenterHorizontal size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon><span className="canvas-menu-item__label">Align Horizontal Center</span></button>
                      <button type="button" className="canvas-menu-item" onClick={() => handleAlignSelected('vcenter')}><MenuIcon><AlignCenterVertical size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} /></MenuIcon><span className="canvas-menu-item__label">Align Vertical Center</span></button>
                    </div>
                  </div>
                </>
              ) : null}
              <div className="canvas-context-menu__divider" />
              <button
                type="button"
                className={`canvas-menu-item is-danger ${canDeleteSelection ? '' : 'is-disabled'}`.trim()}
                onClick={deleteSelectedCanvasItems}
                disabled={!canDeleteSelection}
              >
                <MenuIcon>
                  <Trash2 size={MENU_ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} />
                </MenuIcon>
                <span className="canvas-menu-item__label">Delete Link Card</span>
              </button>
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
      {isAltDragHintVisible ? (
        <div ref={altDragHintRef} className="canvas-alt-drag-hint" role="status" aria-live="polite">
          Hold Alt to move independently
        </div>
      ) : null}
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




