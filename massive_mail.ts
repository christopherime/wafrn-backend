/* eslint-disable require-jsdoc */
'use strict';


import express from 'express';

const Sequelize = require('sequelize');
// sequelize plugins
require('sequelize-hierarchy-fork')(Sequelize);

// operators
const {Op} = require('sequelize');
const environment = require('./environment');

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport(
    environment.emailConfig,
);


const sequelize = new Sequelize(
    environment.databaseConnectionString,
    {
      logging: !environment.prod,
    },
);

const User = sequelize.define('users', {
  id: {
    type: Sequelize.UUID,
    defaultValue: Sequelize.UUIDV4,
    allowNull: false,
    primaryKey: true,
  },
  email: {
    type: Sequelize.STRING,
    allowNull: false,
    unique: true,
  },
  description: Sequelize.TEXT,
  url: {
    type: Sequelize.STRING,
    unique: true,
  },
  NSFW: Sequelize.BOOLEAN,
  avatar: Sequelize.STRING,
  password: Sequelize.STRING,
  birthDate: Sequelize.DATE,
  activated: Sequelize.BOOLEAN,
  // we see the date that the user asked for a password reset. Valid for 2 hours
  requestedPasswordReset: Sequelize.DATE,
  // we use activationCode for activating the account & for reset the password
  // could generate some mistakes but consider worth it
  activationCode: Sequelize.STRING,
  registerIp: Sequelize.STRING,
  lastLoginIp: Sequelize.STRING,
  lastTimeNotificationsCheck: {
    type: Sequelize.DATE,
    allowNull: false,
    defaultValue: new Date().setTime(0),
  },
});

const Post = sequelize.define('posts', {
  id: {
    type: Sequelize.UUID,
    defaultValue: Sequelize.UUIDV4,
    allowNull: false,
    primaryKey: true,
  },
  NSFW: Sequelize.BOOLEAN,
  content: Sequelize.TEXT,
});

const Tag = sequelize.define('tags', {
  // NSFW: Sequelize.BOOLEAN,
  tagName: Sequelize.TEXT,
});

const Media = sequelize.define('medias', {
  id: {
    type: Sequelize.UUID,
    defaultValue: Sequelize.UUIDV4,
    allowNull: false,
    primaryKey: true,
  },
  NSFW: Sequelize.BOOLEAN,
  description: Sequelize.TEXT,
  url: Sequelize.TEXT,
  ipUpload: Sequelize.STRING,
});

const PostReport = sequelize.define('postReports', {
  resolved: Sequelize.BOOLEAN,
  severity: Sequelize.INTEGER,
  description: Sequelize.TEXT,
});

const UserReport = sequelize.define('userReports', {
  resolved: Sequelize.BOOLEAN,
  severity: Sequelize.INTEGER,
  description: Sequelize.TEXT,

});

const PostView = sequelize.define('postViews', {
  id: {
    type: Sequelize.UUID,
    defaultValue: Sequelize.UUIDV4,
    allowNull: false,
    primaryKey: true,
  },
  postId: {
    type: Sequelize.UUID,
    allowNull: false,
    references: {
      model: 'posts',
      key: 'id',
    },
    unique: false,
  },
});

PostView.belongsTo(Post);
User.belongsToMany(User, {
  through: 'follows',
  as: 'followed',
  foreignKey: 'followedId',
});

User.belongsToMany(User, {
  through: 'follows',
  as: 'follower',
  foreignKey: 'followerId',
});

User.belongsToMany(User, {
  through: 'blocks',
  as: 'blocker',
  foreignKey: 'blockerId',
});

User.belongsToMany(User, {
  through: 'blocks',
  as: 'blocked',
  foreignKey: 'blockedId',
});

PostReport.belongsTo(User);
PostReport.belongsTo(Post);

UserReport.belongsTo(User, {foreignKey: 'ReporterId'});
UserReport.belongsTo(User, {foreignKey: 'ReportedId'});

User.hasMany(Post);
Post.belongsTo(User);
Post.isHierarchy();
Media.belongsTo(User);
Tag.belongsToMany(Post, {
  through: 'tagPostRelations',
});
Post.belongsToMany(Tag, {
  through: 'tagPostRelations',

});
Media.belongsToMany(Post, {
  through: 'postMediaRelations',
});
Post.belongsToMany(Media, {
  through: 'postMediaRelations',
});


sequelize.sync({
  force: environment.forceSync,
})
    .then(async () => {
      console.log(`Database & tables ready!`);
      if (environment.forceSync) {
        console.log('CLEANING DATA');
      // seeder();
      }
    });


// eslint-disable-next-line max-len
async function sendEmail(email: string, subject: string, contents: string) {
  // const activateLink = code;
  return await transporter.sendMail({
    from: environment.emailConfig.auth.user,
    to: email,
    subject: subject,
    html: contents,
  });
}

async function getBlockedids(userId: string): Promise<string[]> {
  const usr = await User.findOne({
    where: {
      id: userId,
    },
    attributes: ['id'],
  });
  const blocked = usr.getBlocked();
  const blockedBy = usr.getBlocker();
  await Promise.all([blocked, blockedBy]);
  let result = (await blocked).map((blocked: any) => blocked.id);
  result = result.concat((await blockedBy).map((blocker: any) => blocker.id));
  return result.filter((elem: string) => elem != userId);
}

async function getAllPostsIds(userId: string): Promise<string[]> {
  const postsId = await Post.findAll({
    where: {
      userId: userId,
    },
    attributes: ['id'],
  });
  const result = postsId.map((followed: any) => followed.id);
  return result;
}


async function getNotifications(userId: string) {
  const userPosts = await getAllPostsIds(userId);
  const user = await User.findOne({
    where: {
      id: userId,
    },
  });
  const blockedUsers = await getBlockedids(userId);
  const newReblogs = Post.findAll({
    where: {
      parentId: {[Op.in]: userPosts},
      createdAt: {
        [Op.gt]: new Date(user.lastTimeNotificationsCheck),
      },
    },
    include: [
      {
        model: User,
        attributes: ['id', 'avatar', 'url', 'description'],
      },
    ],
    order: [['createdAt', 'DESC']],

  });
  const newFollows = user.getFollower({
    where: {
      createdAt: {
        [Op.gt]: new Date(user.lastTimeNotificationsCheck),
      },
    },
    attributes: ['url', 'avatar'],
  });
  return {
    // eslint-disable-next-line max-len
    follows: (await newFollows).filter((newFollow: any) => blockedUsers.indexOf(newFollow.id) == -1),
    // eslint-disable-next-line max-len
    reblogs: (await newReblogs).filter((newReblog: any) => blockedUsers.indexOf(newReblog.user.id) == -1),
  };
}


User.findAll({
  where: {
    activated: true,
  },
}).then(async (users:any) => {
  await users.forEach(async (user: any) => {
    const notifications = await getNotifications(user.id);
    // eslint-disable-next-line max-len
    const numberNotifications = notifications.follows.length + notifications.reblogs.length;
    const subject = 'Hey ' + user.url + ', you have ' +
      numberNotifications + ' unread notifications in wafrn!';
    const emailBody = '<h1>Hello ' + user.url + ',</h1>' +
    '<h1>We\'ve been working hard at <a href="https://app.wafrn.net">wafrn</a>.</h1>' +
    '<h3>For example, the interface is now A LOT better and it doesn\'t ' +
    'look as awful on pc, as it did on launch day!</h3>' +
    '<p>You might not have realized, but it turns out that you\'ve got ' +
    notifications.follows.length +' new followers in ' +
    '<a href="https://app.wafrn.net">wafrn</a></p>' +
    '<p>And your posts have been reblogged ...' + notifications.reblogs.length +
    ' times!</p>' +
    '<p>Is that a lot? Were some of those numbers zero? Why not come back to ' +
    '<a href="https://app.wafrn.net">wafrn</a> and have some fun?</p>' +
    '<h2>We promise that it\'s a lot better!</h2>' +
    '<h5>We also promise some bugs but what\'s life without a few bugs?</h5>';
    try {
      console.log('sending email to' + user.email);
      await sendEmail(user.email, subject, emailBody);
    } catch (error) {
      console.error(error);
    }
  });
});
