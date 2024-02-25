import { FederatedHost, User, sequelize } from '../../db'
import { environment } from '../../environment'
import { getFederatedHostIdFromUrl } from '../cacheGetters/getHostIdFromUrl'
import { getUserIdFromRemoteId } from '../cacheGetters/getUserIdFromRemoteId'
import { logger } from '../logger'
import { getPetitionSigned } from './getPetitionSigned'
import { Queue } from 'bullmq'
import { processUserEmojis } from './processUserEmojis'
import { fediverseTag } from '../../interfaces/fediverse/tags'
import { Op } from 'sequelize'

const updateUsersQueue = new Queue('UpdateUsers', {
  connection: environment.bullmqConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 1000
  }
})

const deletedUser = environment.forceSync
  ? undefined
  : User.findOne({
      where: {
        url: environment.deletedUser
      }
    })

async function getUserFromCache(remoteId: string) {
  return await User.findByPk(await getUserIdFromRemoteId(remoteId))
}

async function getHostFromCache(displayName: string): Promise<any> {
  const res = await FederatedHost.findByPk(await getFederatedHostIdFromUrl(displayName))
  return res
}

// TODO refactor this thing?
async function getRemoteActor(actorUrl: string, user: any, level = 0, forceUpdate = false): Promise<any> {
  try {
    actorUrl.startsWith(environment.frontendUrl + '/fediverse/blog/')
  } catch (error) {
    logger.debug('actorurl not string')
    logger.debug(actorUrl)
  }
  if (actorUrl.startsWith(environment.frontendUrl + '/fediverse/blog/')) {
    // well this is a local actor
    const localUrl = actorUrl.split(environment.frontendUrl + '/fediverse/blog/')[1].toLowerCase()
    return await User.findOne({
      where: {
        [Op.or]: [sequelize.where(sequelize.fn('LOWER', sequelize.col('url')), 'LIKE', localUrl)]
      }
    })
  }
  if (level === 100) {
    //Actor is not valid.
    return await deletedUser
  }
  const url = new URL(actorUrl)
  const hostQuery = await getHostFromCache(url.host)
  const hostBanned = hostQuery?.blocked

  if (hostBanned) {
    return await deletedUser
  }
  let remoteUser = await getUserFromCache(actorUrl)
  // we check if the user has changed avatar and stuff
  const validUntil = new Date(new Date().getTime() - 24 * 60 * 60 * 1000)
  if ((remoteUser && new Date(remoteUser.updatedAt).getTime() < validUntil.getTime()) || forceUpdate) {
    updateUsersQueue.add('updateUser', { userToUpdate: actorUrl, petitionBy: user }, { jobId: actorUrl })
  }

  if (!remoteUser) {
    try {
      const userPetition = await getPetitionSigned(user, actorUrl)
      let federatedHost = await FederatedHost.findOne({
        where: {
          displayName: url.host.toLowerCase()
        }
      })
      if (!federatedHost) {
        const federatedHostToCreate = {
          displayName: url.host.toLocaleLowerCase(),
          publicInbox: userPetition.endpoints?.sharedInbox
        }
        federatedHost = await FederatedHost.create(federatedHostToCreate)
      }
      const userToCreate = {
        url: `@${userPetition.preferredUsername}@${url.host}`,
        name: userPetition.name,
        email: null,
        description: userPetition.summary,
        avatar: userPetition.icon?.url ? userPetition.icon.url : `${environment.mediaUrl}/uploads/default.webp`,
        headerImage: userPetition.image?.url ? userPetition.image.url : ``,
        password: 'NOT_A_WAFRN_USER_NOT_REAL_PASSWORD',
        publicKey: userPetition.publicKey?.publicKeyPem,
        remoteInbox: userPetition.inbox,
        remoteId: actorUrl,
        activated: true,
        federatedHostId: federatedHost.id
      }
      remoteUser = await User.create(userToCreate)
      await processUserEmojis(
        remoteUser,
        userPetition.tag?.filter((elem: fediverseTag) => elem.type === 'Emoji')
      )
    } catch (error) {
      logger.trace({ message: 'error fetching user', error: error })
    }
  }
  if (remoteUser && remoteUser.banned) {
    return await deletedUser
  }
  return remoteUser
}

export { getRemoteActor }
