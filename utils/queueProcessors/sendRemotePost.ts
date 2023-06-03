import { Op, Sequelize } from 'sequelize'
import { logger } from '../logger'
import { postPetitionSigned } from '../activitypub/postPetitionSigned'
import { postToJSONLD } from '../activitypub/postToJSONLD'
import { LdSignature } from '../activitypub/rsa2017'
import { FederatedHost, Post, User, sequelize } from '../../db'
import getRemoteFollowers from '../activitypub/getRemoteFollowers'
import { environment } from '../../environment'
import { Job } from 'bullmq'

async function sendRemotePostWorker(job: Job) {
  //async function sendRemotePost(localUser: any, post: any) {
  const post = await Post.findOne({
    where: {
      id: job.id
    }
  })
  const localUser = await User.findOne({
    where: {
      id: post.userId
    }
  })

  // servers with shared inbox
  let serversToSendThePost
  // for servers with no shared inbox
  let usersToSendThePost
  // mentioned users
  const mentionedUsers = await User.findAll({
    attributes: ['remoteInbox'],
    where: {
      federatedHostId: { [Op.ne]: null },
      literal: Sequelize.literal(`id IN (SELECT userId FROM postMentionsUserRelations WHERE postId = "${post.id}")`)
    }
  })
  switch (post.privacy) {
    case 1: {
      serversToSendThePost = await FederatedHost.findAll({
        where: {
          publicInbox: { [Op.ne]: null },
          blocked: { [Op.ne]: true },
          literal: sequelize.literal(
            `id in (SELECT federatedHostId from users where users.id IN (SELECT followerId from follows where followedId = '${post.userId}') and federatedHostId is not NULL)`
          )
        }
      })
      usersToSendThePost = usersToSendThePost = await FederatedHost.findAll({
        where: {
          publicInbox: { [Op.eq]: null },
          blocked: false
        },
        include: [
          {
            model: User,
            attributes: ['remoteInbox'],
            where: {
              banned: false,
              literal: Sequelize.literal(
                `users.id IN (SELECT followerId from follows where followedId = "${post.userId}")`
              )
            }
          }
        ]
      })

      break
    }
    case 10: {
      serversToSendThePost = []
      usersToSendThePost = []
      break
    }
    default: {
      serversToSendThePost = await FederatedHost.findAll({
        where: {
          publicInbox: { [Op.ne]: null },
          blocked: false
        }
      })
      usersToSendThePost = await FederatedHost.findAll({
        where: {
          publicInbox: { [Op.eq]: null },
          blocked: false
        },
        include: [
          {
            model: User,
            attributes: ['remoteInbox'],
            where: {
              banned: false
            }
          }
        ]
      })
    }
  }

  if (serversToSendThePost?.length > 0 || usersToSendThePost?.length > 0 || mentionedUsers?.length > 0) {
    const objectToSend = await postToJSONLD(post)
    const ldSignature = new LdSignature()
    const bodySignature: any = await ldSignature.signRsaSignature2017(
      objectToSend,
      localUser.privateKey,
      `${environment.frontendUrl}/fediverse/blog/${localUser.url.toLocaleLowerCase()}`,
      environment.instanceUrl,
      new Date(post.createdAt)
    )

    let inboxes: string[] = []
    inboxes = inboxes.concat(mentionedUsers.map((elem: any) => elem.remoteInbox))
    inboxes = inboxes.concat(serversToSendThePost.map((elem: any) => elem.publicInbox))
    usersToSendThePost?.forEach((server: any) => {
      inboxes = inboxes.concat(server.users.map((elem: any) => elem.remoteInbox))
    })
    let completed = 0
    for await (const remoteInbox of inboxes) {
      try {
        postPetitionSigned({ ...objectToSend, signature: bodySignature.signature }, localUser, remoteInbox).then(()=> {
          job.update(completed / inboxes.length)
          completed = completed + 1
        }).catch(
          (error) => {
            logger.debug(error)
          }
        )
      } catch (bigError) {
        logger.debug(bigError)
      }
    }
  }
}

export { sendRemotePostWorker }
