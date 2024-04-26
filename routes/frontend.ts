import express, { Application } from 'express'
import { environment } from '../environment'
import { Op } from 'sequelize'
import { Media, Post, User } from '../db'
import fs from 'fs'
import * as DOMPurify from "isomorphic-dompurify";
import { redisCache } from '../utils/redis'

export default function frontend(app: Application) {

  app.get('/post/:id', async function (req, res) {
    if (req.params?.id) {
      try {
        const postData = await getPostSEOCache(req.params.id)
        if (postData) {
          res.send(getIndexSeo(postData.title, postData.description, postData.img))
        } else {
          res.status(200).sendFile('/', { root: environment.frontedLocation })
        }
      } catch (error) {
        res.status(200).sendFile('/', { root: environment.frontedLocation })
      }
    } else {
      res.status(200).sendFile('/', { root: environment.frontedLocation })
    }
  })


    // serve default angular application
    app.get(
      [
        '/',
        '/index.html',
        '/index',
        '/blog/*',
        '/dashboard/*',
        '/dashboard',
        '/post/*',
        '/login',
        '/register',
        '/privacy',
        '/admin/*',
        '/profile/*'
      ],
      function (req, res) {
        //res.status(200).sendFile('/', { root: environment.frontedLocation })
        const defaultSeoData = environment.defaultSEOData
        res.send(getIndexSeo(defaultSeoData.title, defaultSeoData.description, defaultSeoData.img))
      }
    )
  // serve static angular files
  app.get('*.*', express.static(environment.frontedLocation, { maxAge: '1s' }))
}

function sanitizeStringForSEO(unsanitized: string): string {
  return DOMPurify.sanitize(unsanitized, {ALLOWED_TAGS: [], }).replaceAll('"', "'")
}



async function getPostSEOCache(id: string) : Promise<{ title: string; description: string; img: string }> {
  return environment.defaultSEOData; /*
  const resData = await redisCache.get('postSeoCache:' + id)
  let res = environment.defaultSEOData
  if (!resData) {
    const post = await Post.findOne({
      where: {
        id: id,
        privacy: { [Op.notIn]: [10, 1] }
      },
      attributes: ['content'],
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['url', 'avatar']
        },
        {
          model: Media,
          attributes: ['NSFW', 'url', 'external']
        }
      ]
    })
    if(post) {
      res.title = `${post.user.url.startsWith('@') ? 'External' : 'Wafrn'} post by ${sanitizeStringForSEO(post.user.url)}`.substring(0, 65)
      res.description = (post.content_warning ? `Post has content warning: ${sanitizeStringForSEO(post.content_warning)}` : sanitizeStringForSEO(post.content)).substring(0, 190)
      const safeMedia = post.medias?.find((elem: any) => elem.NSFW === false)
      res.img = safeMedia ? safeMedia.url : `${environment.frontendUrl}/assets/logo.png`
      redisCache.set('postSeoCache:' + id, JSON.stringify(res), 'EX', 300)
    }
  } else {
    res = JSON.parse(resData)
  }
  return res;
  */
}

function getIndexSeo(title: string, description: string, image: string) {
  const sanitizedTitle = title.replaceAll('"', "'")
  const sanitizedDescription = description.replaceAll('"', "'").substring(0, 500)
  const imgUrl = image.toLowerCase().startsWith('https')
    ? environment.externalCacheurl + encodeURIComponent(image)
    : environment.mediaUrl + image
  let indexWithSeo = fs.readFileSync(`${environment.frontedLocation}/index.html`).toString()
  // index html must have a section with this html comment that we will edit out to put the seo there
  const commentToReplace = '<!-- REMOVE THIS IN EXPRESS FOR SEO -->'
  indexWithSeo = indexWithSeo.replace(
    commentToReplace,
    `<meta property="og:title" content="${sanitizedTitle}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${sanitizedTitle}">
    <meta name="description" content="${sanitizedDescription}">
    <meta property="og:description" content="${sanitizedDescription}">
    <meta name="twitter:description" content="${sanitizedDescription}">
    <meta property="og:image" content="${imgUrl}">
    <meta name="twitter:image" content="${imgUrl}">`
  )

  return indexWithSeo
}