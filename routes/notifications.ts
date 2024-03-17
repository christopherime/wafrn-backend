import { Application, Response } from 'express'
import { Op, Sequelize } from 'sequelize'
import { Follows, Post, PostMentionsUserRelation, PostReport, User, UserLikesPostRelations } from '../db'
import { authenticateToken } from '../utils/authenticateToken'

import { sequelize } from '../db'
import getStartScrollParam from '../utils/getStartScrollParam'
import { environment } from '../environment'
import AuthorizedRequest from '../interfaces/authorizedRequest'
import { getMutedPosts } from '../utils/cacheGetters/getMutedPosts'
import getBlockedIds from '../utils/cacheGetters/getBlockedIds'

export default function notificationRoutes(app: Application) {
  app.get('/api/v2/notificationsScroll', authenticateToken, async (req: AuthorizedRequest, res: Response) => {
    const userId = req.jwtData?.userId ? req.jwtData?.userId : ''
    // MULTIPLE DATES ON SAME ENDPOINT SO
    const likesDate = req.query?.likesDate ? new Date(req.query.likesDate as string) : new Date()
    const followsDate = req.query?.followsDate ? new Date(req.query.followsDate as string) : new Date()
    const reblogsDate = req.query?.reblogsDate ? new Date(req.query.reblogsDate as string) : new Date()
    const mentionsDate = req.query?.mentionsDate ? new Date(req.query.mentionsDate as string) : new Date()
    const reblogQuery: any = await getReblogQuery(userId, reblogsDate)
    reblogQuery.where.createdAt = {
      [Op.lt]: reblogsDate
    }
    const reblogs = Post.findAll({
      ...reblogQuery,
      limit: environment.postsPerPage,
      order: [['createdAt', 'DESC']]
    })

    const mentionsQuery: any = await getQueryMentions(userId)
    mentionsQuery.where = {
      ...mentionsQuery.where,
      createdAt: {
        [Op.lt]: mentionsDate
      }
    }
    const mentions = await Post.findAll({
      ...mentionsQuery,
      limit: environment.postsPerPage,
      order: [['createdAt', 'DESC']]
    })
    const followsQuery: any = await getNewFollows(userId, followsDate)
    followsQuery.where.createdAt = {
      [Op.lt]: followsDate
    }
    const follows = Follows.findAll({
      ...followsQuery,
      limit: environment.postsPerPage,
      order: [['createdAt', 'DESC']]
    })
    const likesQuery: any = await getQueryLikes(userId, likesDate)
    likesQuery.where.createdAt = {
      [Op.lt]: likesDate
    }
    const likes = UserLikesPostRelations.findAll({
      ...likesQuery,
      limit: environment.postsPerPage,
      order: [['createdAt', 'DESC']]
    })
    await Promise.all([reblogs, mentions, follows, likes])
    res.send({
      reblogs: await reblogs,
      likes: await likes,
      mentions: await mentions,
      follows: (await follows).map((follow: any) => {
        return { ...follow.followed.dataValues, createdAt: follow.createdAt }
      })
    })
  })

  app.get('/api/v2/notificationsCount', authenticateToken, async (req: AuthorizedRequest, res: Response) => {
    const userId = req.jwtData?.userId ? req.jwtData?.userId : ''
    //const blockedUsers = await getBlockedIds(userId)
    const startCountDate = (await User.findByPk(userId)).lastTimeNotificationsCheck
    const mentionsQuery: any = await getQueryMentions(userId)
    mentionsQuery.where = {
      ...mentionsQuery.where,
      createdAt: {
        [Op.gt]: startCountDate
      }
    }
    const postMentions = Post.count(mentionsQuery)
    const newPostReblogs = Post.count(await getReblogQuery(userId, startCountDate))

    const newFollows = Follows.count(await getNewFollows(userId, startCountDate))

    const newLikes = UserLikesPostRelations.count(await getQueryLikes(userId, startCountDate))

    let reports = 0
    let awaitingAproval = 0

    if (req.jwtData?.role === 10) {
      // well the user is an admin!
      reports = PostReport.count({
        where: {
          resolved: false
        }
      })
      awaitingAproval = User.count({
        where: {
          activated: false,
          url: {
            [Op.notLike]: '%@%'
          },
          banned: false
        }
      })
    }

    await Promise.all([newFollows, postMentions, newLikes, reports, awaitingAproval, newPostReblogs])

    res.send({
      notifications: (await newFollows) + (await postMentions) + (await newLikes) + (await newPostReblogs),
      reports: await reports,
      awaitingAproval: await awaitingAproval
    })
  })
  async function getQueryMentions(userId: string) {
    const latestMentionsIds = (
      await PostMentionsUserRelation.findAll({
        attributes: ['postId'],
        where: {
          userId: userId
        }
      })
    ).map((elem: any) => elem.postId)
    return {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['url', 'name', 'id', 'avatar']
        }
      ],
      where: {
        id: {
          [Op.notIn]: await getMutedPosts(userId),
          [Op.in]: latestMentionsIds
        },
        parentId: {
          [Op.notIn]: await getMutedPosts(userId)
        },
        userId: {
          [Op.notIn]: (await getBlockedIds(userId)).push(userId)
        }
      }
    }
  }

  async function getQueryLikes(userId: string, startCountDate: Date) {
    return {
      include: [
        {
          model: Post,
          required: true,
          attributes: ['userId'],
          where: {
            userId: userId
          }
        },
        {
          model: User,
          attributes: ['url', 'name', 'id', 'avatar']
        }
      ],
      where: {
        postId: {
          [Op.notIn]: await getMutedPosts(userId)
        },
        createdAt: {
          [Op.gt]: startCountDate
        },
        userId: {
          [Op.notIn]: await getBlockedIds(userId)
        }
      }
    }
  }

  async function getNewFollows(userId: string, startCountDate: Date) {
    return {
      include: [
        {
          model: User,
          as: 'followed',
          attributes: ['url', 'avatar', 'name', 'remoteId']
        }
      ],
      where: {
        followerId: {
          [Op.notIn]: await getBlockedIds(userId)
        },
        createdAt: {
          [Op.gt]: startCountDate
        },
        followedId: userId
      }
    }
  }

  // TODO optimize this in a way that a reblog reply only counts as a mention
  async function getReblogQuery(userId: string, startCountDate: Date) {
    const mentions = await PostMentionsUserRelation.findAll({
      attributes: ['postId'],
      where: {
        userId: userId,
        createdAt: {
          [Op.gt]: startCountDate
        }
      }
    })
    return {
      include: [
        {
          model: Post,
          as: 'ancestors',
          required: true,
          attributes: ['content', 'id'],
          where: {
            userId: userId
          }
        },
        {
          model: User,
          as: 'user',
          attributes: ['url', 'avatar', 'name', 'remoteId']
        }
      ],
      where: {
        id: {
          [Op.notIn]: mentions.map((elem: any) => elem.postId)
        },
        parentId: {
          [Op.notIn]: await getMutedPosts(userId)
        },
        privacy: {
          [Op.ne]: 10
        },
        createdAt: {
          [Op.gt]: startCountDate
        },
        userId: {
          [Op.notIn]: (await getBlockedIds(userId)).push(userId)
        }
      }
    }
  }
}
