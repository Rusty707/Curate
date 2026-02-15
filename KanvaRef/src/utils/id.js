const CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const ID_LENGTH = 8

export function generateBoardId() {
  let id = ''

  for (let i = 0; i < ID_LENGTH; i += 1) {
    const randomIndex = Math.floor(Math.random() * CHARSET.length)
    id += CHARSET[randomIndex]
  }

  return id
}
