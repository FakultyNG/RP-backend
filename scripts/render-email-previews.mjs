import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ejs from 'ejs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = path.join(projectRoot, 'artifacts', 'email-previews')

const previews = [
  { template: 'verify-email', pin: '482193' },
  { template: 'reset-pass', pin: '715204' },
  { template: 'reset-pin', pin: '3086' },
  { template: 'autorenew-success', pin: 'Visa ending in 4242' },
  { template: 'autorenew-fail', pin: 'Your payment method was declined' },
]

await mkdir(outputDirectory, { recursive: true })

for (const preview of previews) {
  const templatePath = path.join(projectRoot, 'src', 'views', `${preview.template}.ejs`)
  const outputPath = path.join(outputDirectory, `${preview.template}.html`)
  const html = await ejs.renderFile(templatePath, {
    name: 'Amara Okafor',
    pin: preview.pin,
    footerYear: new Date().getFullYear(),
  })

  await writeFile(outputPath, html, 'utf8')
}

console.log(`Rendered ${previews.length} email previews to ${outputDirectory}`)
