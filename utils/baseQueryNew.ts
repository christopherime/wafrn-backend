import { Op } from 'sequelize'
import {
  Emoji,
  EmojiReaction,
  Media,
  Post,
  PostEmojiRelations,
  PostMentionsUserRelation,
  PostTag,
  QuestionPoll,
  QuestionPollAnswer,
  QuestionPollQuestion,
  User,
  UserEmojiRelation,
  UserLikesPostRelations
} from '../db'
import getPosstGroupDetails from './getPostGroupDetails'

async function getMedias(postIds: string[]) {
  return await Media.findAll({
    attributes: ['id', 'NSFW', 'description', 'url', 'adultContent', 'external'],
    include: [
      {
        model: Post,
        attributes: ['id'],
        where: {
          id: {
            [Op.in]: postIds
          }
        }
      }
    ]
  })
}
async function getMentionedUserIds(
  postIds: string[]
): Promise<{ usersMentioned: string[]; postMentionRelation: any[] }> {
  const mentions = await PostMentionsUserRelation.findAll({
    attributes: ['userId', 'postId'],
    where: {
      postId: {
        [Op.in]: postIds
      }
    }
  })
  const usersMentioned = mentions.map((elem: any) => elem.userId)
  const postMentionRelation = mentions.map((elem: any) => {
    return { userMentioned: elem.userId, post: elem.postId }
  })
  return { usersMentioned, postMentionRelation }
}

async function getTags(postIds: string[]) {
  return await PostTag.findAll({
    attributes: ['postId', 'tagName'],
    where: {
      postId: {
        [Op.in]: postIds
      }
    }
  })
}

async function getLikes(postIds: string[]) {
  return await UserLikesPostRelations.findAll({
    attributes: ['userId', 'postId'],
    where: {
      postId: {
        [Op.in]: postIds
      }
    }
  })
}

async function getEmojis(input: { userIds: string[]; postIds: string[] }): Promise<{
  userEmojiRelation: any[]
  postEmojiRelation: any[]
  postEmojiReactions: any[]
  emojis: []
}> {
  let postEmojisIds = PostEmojiRelations.findAll({
    attributes: ['emojiId', 'postid'],
    where: {
      postId: {
        [Op.in]: input.postIds
      }
    }
  })

  let postEmojiReactions = EmojiReaction.findAll({
    where: {
      postId: {
        [Op.in]: input.postIds
      }
    }
  })

  let userEmojiId = UserEmojiRelation.findAll({
    attributes: ['emojiId', 'userId'],
    where: {
      userId: {
        [Op.in]: input.userIds
      }
    }
  })

  await Promise.all([postEmojisIds, userEmojiId, postEmojiReactions])
  postEmojisIds = await postEmojisIds
  userEmojiId = await userEmojiId
  postEmojiReactions = await postEmojiReactions

  const emojiIds = []
    .concat(postEmojisIds.map((elem: any) => elem.emojiId))
    .concat(userEmojiId.map((elem: any) => elem.emojiId))
    .concat(postEmojiReactions.map((reaction: any) => reaction.emojiId))
  return {
    userEmojiRelation: await userEmojiId,
    postEmojiRelation: await postEmojisIds,
    postEmojiReactions: await postEmojiReactions,
    emojis: await Emoji.findAll({
      attributes: ['id', 'url', 'external', 'name'],
      where: {
        id: {
          [Op.in]: emojiIds
        }
      }
    })
  }
}

async function getUnjointedPosts(postIdsInput: string[], posterId: string) {
  // we need a list of all the userId we just got from the post
  let userIds: string[] = []
  const postIds: string[] = []
  const posts = await Post.findAll({
    include: [
      {
        model: Post,
        as: 'ancestors'
      }
    ],
    where: {
      id: {
        [Op.in]: postIdsInput
      }
    }
  })
  posts.forEach((post: any) => {
    userIds.push(post.userId)
    postIds.push(post.id)
    post.ancestors?.forEach((ancestor: any) => {
      userIds.push(ancestor.userId)
      postIds.push(ancestor.id)
    })
  })
  const emojis = getEmojis({
    userIds,
    postIds
  })
  const mentions = await getMentionedUserIds(postIds)
  userIds = userIds.concat(mentions.usersMentioned)

  const users = User.findAll({
    attributes: ['url', 'avatar', 'id', 'name', 'remoteId'],
    where: {
      id: {
        [Op.in]: userIds
      }
    }
  })
  const polls = QuestionPoll.findAll({
    where: {
      postId: {
        [Op.in]: postIds
      }
    },
    include: [
      {
        model: QuestionPollQuestion,
        include: [
          {
            model: QuestionPollAnswer,
            required: false,
            where: {
              userId: posterId
            }
          }
        ]
      }
    ]
  })

  const medias = getMedias(postIds)
  const tags = getTags(postIds)
  const likes = getLikes(postIds)
  const postWithNotes = getPosstGroupDetails(posts)
  await Promise.all([emojis, users, polls, medias, tags, likes, postWithNotes])

  return {
    posts: await postWithNotes,
    emojiRelations: await emojis,
    mentions: mentions.postMentionRelation,
    users: await users,
    polls: await polls,
    medias: await medias,
    tags: await tags,
    likes: await likes
  }
}

export { getUnjointedPosts }