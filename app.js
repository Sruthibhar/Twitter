const express = require('express')
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const app = express()
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const dbpath = path.join(__dirname, 'twitterClone.db')
let db = null
app.use(express.json())
const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbpath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB Error:${e.message}`)
    process.exit(1)
  }
}
initializeDBAndServer()
app.post('/register', async (request, response) => {
  const {username, name, password, gender} = request.body
  const hashedPassword = await bcrypt.hash(request.body.password, 10)
  const selectUserQuery = `
    SELECT * FROM user WHERE username='${username}';
    `
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    if (request.body.password.length > 5) {
      const createUserQuery = `
        INSERT INTO user(username,name,password,gender) VALUES ('${username}','${name}','${hashedPassword}','${gender}')
        `
      const dbResponse = await db.run(createUserQuery)
      response.status(200)
      response.send('User created successfully')
    } else {
      response.status(400)
      response.send('Password is too short')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})
app.post('/login', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `
  SELECT * FROM user WHERE username='${username}';
  `
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {username: username}
      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})
const authentication = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}
app.get('/user/tweets/feed/', authentication, async (request, response) => {
  const {username} = request
  const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserQuery)
  const userId = dbUser['user_id']
  const query = `
  SELECT user.username,follower.following_user_id,tweet.tweet,tweet.date_time AS dateTime FROM (user INNER JOIN follower ON user.user_id=follower.following_user_id) AS T INNER JOIN tweet ON T.following_user_id=tweet.user_id WHERE follower_user_id=${userId} ORDER BY dateTime DESC LIMIT 4;
  `
  const data = await db.all(query)
  response.send(data)
})
app.get('/user/following/', authentication, async (request, response) => {
  const {username} = request
  const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserQuery)
  const userId = dbUser['user_id']
  const query = `
  SELECT  user.username FROM user INNER JOIN follower ON user.user_id=follower.following_user_id WHERE follower.follower_user_id=${userId};
  `
  const dbresponse = await db.all(query)
  response.send(dbresponse)
})
app.get('/user/followers/', authentication, async (request, response) => {
  const {username} = request
  const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserQuery)
  const userId = dbUser['user_id']
  const query = `
  SELECT DISTINCT user.username FROM user INNER JOIN follower ON user.user_id=follower.follower_user_id WHERE follower.following_user_id=${userId};
  `
  const dbresponse = await db.all(query)
  response.send(dbresponse)
})
const isUserFollowing = async (request, response, next) => {
  const {tweetId} = request.params
  const {username} = request
  const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserQuery)
  const userId = dbUser['user_id']
  const followingUserquery = `
  SELECT following_user_id FROM follower WHERE follower_user_id=${userId};
  `
  const followingData = await db.all(followingUserquery)
  const tweetDataquery = `
  SELECT * FROM tweet WHERE tweet_id=${tweetId};
  `
  const tweetData = await db.get(tweetDataquery)
  const tweetUserId = tweetData['user_id']
  let isfollowing = false
  followingData.forEach(each => {
    if (each['following_user_id'] === tweetUserId) {
      isfollowing = true
    }
  })
  if (isfollowing !== true) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}
app.get(
  '/tweets/:tweetId/',
  authentication,
  isUserFollowing,
  async (request, response) => {
    const {tweetId} = request.params
    const qury = `
  SELECT tweet.tweet,COUNT(like.like_id) AS likes,COUNT(reply.reply_id) AS replies,date_time AS dateTime FROM (tweet INNER JOIN like ON tweet.tweet_id=like.tweet_id) AS T INNER JOIN reply ON T.tweet_id=reply.tweet_id  WHERE tweet.tweet_id=${tweetId};
  `
    const dbResponse = await db.get(qury)
    response.send(dbResponse)
  },
)
app.get(
  '/tweets/:tweetId/likes/',
  authentication,
  isUserFollowing,
  async (request, response) => {
    const {tweetId} = request.params
    const query = `
  SELECT username FROM user NATURAL JOIN tweet WHERE tweet_id=${tweetId};
  `
    const dbResponse = await db.all(query)
    const array = dbResponse.map(eachobj => eachobj.username)
    response.send({likes: array})
  },
)
app.get(
  '/tweets/:tweetId/replies/',
  authentication,
  isUserFollowing,
  async (request, response) => {
    const {tweetId} = request.params
    const query = `SELECT name,reply FROM user NATURAL JOIN reply WHERE tweet_id=${tweetId};`
    const dbResponse = await db.all(query)
    response.send({replies: dbResponse})
  },
)
app.get('/user/tweets/', authentication, async (request, response) => {
  const {username} = request
  const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserQuery)
  const userId = dbUser['user_id']
  const query = `
    SELECT tweet, COUNT() AS likes, date_time As dateTime
    FROM tweet INNER JOIN like
    ON tweet.tweet_id = like.tweet_id
    WHERE tweet.user_id = ${userId}
    GROUP BY tweet.tweet_id;`
  let likesData = await db.all(query)
  const repliesQuery = `
    SELECT tweet, COUNT() AS replies
    FROM tweet INNER JOIN reply
    ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id = ${userId}
    GROUP BY tweet.tweet_id;`
  const repliesData = await db.all(repliesQuery)
  likesData.forEach(each => {
    for (let data of repliesData) {
      if (each.tweet === data.tweet) {
        each.replies = data.replies
        break
      }
    }
  })
  response.send(likesData)
})
app.post('/user/tweets/', authentication, async (request, response) => {
  const {username} = request
  const {tweet} = request.body
  const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserQuery)
  const userId = dbUser['user_id']
  const createTweet = `
  INSERT INTO tweet(tweet,user_id)  VALUES ('${tweet}',${userId}) ;
  `
  await db.run(createTweet)
  response.send('Created a Tweet')
})
app.delete('/tweets/:tweetId/', authentication, async (request, response) => {
  const {username} = request
  const {tweetId} = request.params
  const getUserQuery = `
    SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(getUserQuery)
  const userId = dbUser['user_id']
  const query1 = `
  SELECT tweet_id FROM tweet NATURAL JOIN user WHERE user_id=${userId};
  `
  const dbresponse1 = await db.all(query1)
  let isusertweet = false
  dbresponse1.forEach(each => {
    if (each['tweet_id'] == tweetId) {
      isusertweet = true
    }
  })
  if (isusertweet) {
    const deletequery = `
    DELETE FROM tweet WHERE tweet_id=${tweetId}
    `
    await db.run(deletequery)
    response.send('Tweet Removed')
  } else {
    response.status(401)
    response.send('Invalid Request')
  }
})
module.exports = app
