let defaultLogo

/** Embed the existing dashboard logo at email size instead of requiring an upload. */
export function loadClientPeriodMailLogo() {
  if (!defaultLogo) {
    defaultLogo = new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = 440
          canvas.height = Math.round(image.naturalHeight * canvas.width / image.naturalWidth)
          const context = canvas.getContext('2d')
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, canvas.width, canvas.height)
          context.drawImage(image, 0, 0, canvas.width, canvas.height)
          resolve(canvas.toDataURL('image/jpeg', 0.85))
        } catch (error) { reject(error) }
      }
      image.onerror = () => reject(new Error('Unable to load the company logo. Refresh the page and try again.'))
      image.src = `${import.meta.env.BASE_URL || '/'}fleetpro-logo.png`
    }).catch((error) => { defaultLogo = null; throw error })
  }
  return defaultLogo
}
