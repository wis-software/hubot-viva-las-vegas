// Description:
//   A Hubot script which helps users to create leave requests.
//
// Configuration:
//   LEAVE_COORDINATION_CHANNEL - ...
//   MAXIMUM_LENGTH_OF_LEAVE - The maximum number of days an employee is allowed to be on leave
//   MAXIMUM_LENGTH_OF_WAIT - The maximum number of days each request may take
//
// Commands:
//   hubot хочу в отпуск - initiates a new leave request
//   hubot одобрить заявку @username - approves the leave request for the specified user (privileged: admins only)
//   hubot отклонить заявку @username - rejects the leave request for the specified user (privileged: admins only)
//   hubot отменить заявку @username - cancels the approved leave request for the specified user (privileged: admins only)
//

module.exports = async (robot) => {
  const moment = require('moment')
  const schedule = require('node-schedule')

  const LEAVE_COORDINATION_CHANNEL = process.env.LEAVE_COORDINATION_CHANNEL || 'leave-coordination'
  const MAXIMUM_LENGTH_OF_LEAVE = parseInt(process.env.MAXIMUM_LENGTH_OF_LEAVE, 10) || 28
  const MAXIMUM_LENGTH_OF_WAIT = parseInt(process.env.MAXIMUM_LENGTH_OF_WAIT, 10) || 7
  const MINIMUM_DAYS_BEFORE_REQUEST = parseInt(process.env.MINIMUM_DAYS_BEFORE_REQUEST, 14) || 14
  const REMINDER_SCHEDULER = process.env.REMINDER_SCHEDULER || '0 0 7 * * *'

  const INIT_STATE = 0
  const FROM_STATE = 1
  const TO_STATE = 2
  const CONFIRM_STATE = 3

  const APPROVED_STATUS = 'approved'
  const PENDING_STATUS = 'pending'
  const READY_TO_APPLY_STATUS = 'ready-to-apply'

  const ANGRY_MESSAGE = 'Давай по порядку!'

  const ACCESS_DENIED = 'У вас недостаточно прав для этой команды'

  const regExpMonthYear = new RegExp(/((0?[1-9]|[12][0-9]|3[01])\.(0?[1-9]|1[0-2]))$/)

  // Checking if the bot is in the channel specified via the LEAVE_COORDINATION_CHANNEL environment variable.
  const botChannels = await robot.adapter.api.get('channels.list.joined')
  const botGroups = await robot.adapter.api.get('groups.list')
  const chExists = botChannels.channels.filter(item => item.name === LEAVE_COORDINATION_CHANNEL).length
  const grExists = botGroups.groups.filter(item => item.name === LEAVE_COORDINATION_CHANNEL).length
  if (!chExists && !grExists) {
    robot.logger.error(`Hubot is not in the group or channel named '${LEAVE_COORDINATION_CHANNEL}'`)
    return
  }

  // Here is the format string which is suitable for the following cases: DD.MM, D.M
  // See https://momentjs.com/docs/#/parsing/string-format/ for details.
  const DATE_FORMAT = 'D.M'
  const USER_FRIENDLY_DATE_FORMAT = 'дд.мм'
  const CREATION_DATE_FORMAT = 'DD.MM.YYYY'

  const statesMessages = Object.freeze([
    '',
    `C какого числа ты бы хотел уйти в отпуск? (${USER_FRIENDLY_DATE_FORMAT})`,
    `До какого числа ты планируешь быть в отпуске? (${USER_FRIENDLY_DATE_FORMAT})`,
    'Отправить текущую заявку в HR-отдел? (да/нет)'
  ])

  /**
   * Use API returns user has a role
   * @param {Robot} robot Hubot instance
   * @param {string} username Username
   * @return {boolean}
   */
  async function isAdmin (robot, username) {
    const info = await robot.adapter.api.get('users.info', { username: username })

    if (!info.user) {
      throw new Error('User data did not include roles')
    }

    if (!info.user.roles) {
      throw new Error('User data did not include roles')
    }

    return info.user.roles.indexOf('admin') !== -1
  }

  function checkIfUserExists (robot, username) {
    const users = robot.brain.data.users
    const usernames = Object.values(users).map(user => user.name)

    return usernames.indexOf(username) > -1
  }

  function getStateFromBrain (robot, username) {
    const users = robot.brain.usersForFuzzyName(username)

    users[0].vivaLasVegas = users[0].vivaLasVegas || {}

    return users[0].vivaLasVegas
  }

  /**
   * Checks if the specified date
   * 1. follows the format stored in the DATE_FORMAT constant
   * 2. is a valid date.
   *
   * @param {string} date
   * @returns {boolean}
   */
  function isValidDate (date) {
    return typeof date === 'string' && moment(date, DATE_FORMAT, true).isValid()
  }

  function noname (daysNumber) {
    const lastDigit = parseInt(daysNumber.toString().split('').pop(), 10)
    switch (lastDigit) {
      case 0:
        return `${daysNumber} дней`
      case 1:
        return `${daysNumber} день`
      case 2:
      case 3:
      case 4:
        return `${daysNumber} дня`
      default:
        return `${daysNumber} дней`
    }
  }

  function sendRemindersToChannel (robot) {
    const users = robot.brain.data.users

    for (const user of Object.values(users)) {
      const state = getStateFromBrain(robot, user.name)

      if (state.requestStatus === PENDING_STATUS) {
        const deadline = moment(state.creationDate, CREATION_DATE_FORMAT).add(MAXIMUM_LENGTH_OF_WAIT, 'days').format('DD.MM')

        robot.messageRoom(LEAVE_COORDINATION_CHANNEL, `Нужно дать ответ @${user.name} до ${deadline}.`)
      }
    }
  }

  robot.respond(/хочу в отпуск$/i, function (msg) {
    const state = getStateFromBrain(robot, msg.message.user.name)

    if (state.n !== undefined && state.n !== INIT_STATE) {
      msg.send(`${ANGRY_MESSAGE}\n${statesMessages[state.n]}`)

      return
    }

    if (state.requestStatus === APPROVED_STATUS) {
      msg.send('Твоя предыдущая заявка была одобрена, так что сначала отгуляй этот отпуск.')

      return
    }

    if (state.requestStatus === PENDING_STATUS) {
      msg.send('Ты уже отправил заявку на отпуск. Дождись ответа.')

      return
    }

    state.creationDate = moment().format(CREATION_DATE_FORMAT)
    state.n = FROM_STATE

    msg.send(`Ok, с какого числа? (${USER_FRIENDLY_DATE_FORMAT})`)
  })

  robot.respond(regExpMonthYear, function (msg) {
    const date = msg.match[1]
    const day = parseInt(msg.match[2])
    const month = parseInt(msg.match[3])
    const state = getStateFromBrain(robot, msg.message.user.name)

    if (!isValidDate(date)) {
      msg.send(`Указанная дата является невалидной. Попробуй еще раз.`)

      return
    }

    if (state.n === FROM_STATE) {
      const today = moment()
      // moment().month() starts counting with 0
      const year = today.month() + 1 >= month && today.date() >= day ? today.year() + 1 : today.year()
      const startDay = moment(`${day}.${month}.${year}`, 'D.M.YYYY')
      const daysBefore = startDay.diff(today, 'days')

      if (daysBefore < MINIMUM_DAYS_BEFORE_REQUEST) {
        const minDate = today.add(MINIMUM_DAYS_BEFORE_REQUEST, 'd').format('DD.MM.YYYY')
        msg.send(`Нужно запрашивать отпуск минимум за ${noname(MINIMUM_DAYS_BEFORE_REQUEST)}, а до твоего - только ${noname(daysBefore)}. Попробуй выбрать дату позднее ${minDate}.`)
        return
      }

      const leaveStart = {}

      leaveStart.day = day
      leaveStart.month = month
      leaveStart.year = year

      state.leaveStart = leaveStart
      state.n = TO_STATE

      msg.send(`Отлично, по какое? (${USER_FRIENDLY_DATE_FORMAT})`)

      return
    }

    if (state.n === TO_STATE) {
      const leaveStart = state.leaveStart
      const leaveEnd = {}
      const year = leaveStart.month >= month && leaveStart.day >= day ? leaveStart.year + 1 : leaveStart.year
      const d1 = moment(`${leaveStart.day}.${leaveStart.month}.${leaveStart.year}`, 'D.M.YYYY')
      const d2 = moment(`${day}.${month}.${year}`, 'D.M.YYYY')
      const daysNumber = d2.diff(d1, 'days')

      if (daysNumber > MAXIMUM_LENGTH_OF_LEAVE) {
        msg.send(`Отпуск продолжительностью ${noname(daysNumber)} выглядит круто (особенно если он оплачиваемый :joy:), но ты можешь претендовать максимум на ${noname(MAXIMUM_LENGTH_OF_LEAVE)}.`)

        return
      }

      leaveEnd.day = day
      leaveEnd.month = month
      leaveEnd.year = year

      state.leaveEnd = leaveEnd
      state.n = CONFIRM_STATE

      msg.send(`Значит ты планируешь находиться в отпуске ${noname(daysNumber)}. Все верно? (да/нет)`)
    }
  })

  robot.respond(/(да|нет)$/i, function (msg) {
    const username = msg.message.user.name
    const state = getStateFromBrain(robot, username)

    if (state.n === CONFIRM_STATE) {
      const answer = msg.match[1]

      if (answer === 'да') {
        const deadline = moment(state.creationDate, CREATION_DATE_FORMAT).add(MAXIMUM_LENGTH_OF_WAIT, 'days').format('DD.MM')
        const from = moment(`${state.leaveStart.day}.${state.leaveStart.month}`, 'D.M').format('DD.MM')
        const to = moment(`${state.leaveEnd.day}.${state.leaveEnd.month}`, 'D.M').format('DD.MM')

        robot.messageRoom(LEAVE_COORDINATION_CHANNEL, `@${username} хочет в отпуск с ${from} по ${to}. Ответ нужно дать до ${deadline}.`)

        state.requestStatus = PENDING_STATUS

        msg.send(`Заявка на отпуск отправлена. Ответ поступит не позже чем через ${noname(MAXIMUM_LENGTH_OF_WAIT)}.`)
      } else {
        msg.send('Я прервал процесс формирования заявки на отпуск.')
      }

      state.n = INIT_STATE
    }
  })

  robot.respond(/(отменить заявку @?(.+))$/i, async (msg) => {
    if (!await isAdmin(robot, msg.message.user.name)) {
      msg.send(ACCESS_DENIED)
      return
    }

    const username = msg.match[2].trim()
    const state = getStateFromBrain(robot, username)

    const isRequestStatus = state.requestStatus && state.requestStatus !== READY_TO_APPLY_STATUS

    if (isRequestStatus) {
      state.n = INIT_STATE
      delete state.leaveStart
      delete state.leaveEnd
      delete state.requestStatus

      robot.messageRoom(LEAVE_COORDINATION_CHANNEL, `@${msg.message.user.name} отменил заявку на отпуск пользователя @${username}`)
      robot.adapter.sendDirect({ user: { name: username } }, 'Ваша заявка на отпуск отменена')
      msg.send(`Отпуск пользователя @${username} отменен`)
    } else {
      msg.send('Этот человек не собирается в отпуск')
    }
  })

  robot.respond(/(одобрить|отклонить) заявку @?(.+)$/i, async (msg) => {
    const action = msg.match[1]
    const username = msg.match[2].trim()

    if (!await isAdmin(robot, msg.message.user.name)) {
      msg.send(ACCESS_DENIED)
      return
    }

    if (checkIfUserExists(robot, username)) {
      const state = getStateFromBrain(robot, username)
      let requestStatus
      let result

      if (state.requestStatus !== PENDING_STATUS) {
        msg.send('У этого пользователя нет ожидающей ответа заявки.')

        return
      }

      if (action === 'одобрить') {
        result = 'одобрена'
        requestStatus = APPROVED_STATUS
      } else {
        result = 'отклонена'
        requestStatus = READY_TO_APPLY_STATUS
      }

      state.requestStatus = requestStatus

      msg.send(`Заявка @${username} ${result}. Я отправлю ему уведомление об этом.`)

      robot.adapter.sendDirect({ user: { name: username } }, `Заявка на отпуск ${result}.`)
    } else {
      msg.send('Пользователя с таким именем нет или я его просто не знаю, т.к. он ни разу не говорил со мной.')
    }
  })

  if (REMINDER_SCHEDULER) {
    schedule.scheduleJob(REMINDER_SCHEDULER, () => sendRemindersToChannel(robot))
  }
}
