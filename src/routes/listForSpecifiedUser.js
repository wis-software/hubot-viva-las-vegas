const moment = require('moment')
const routines = require('hubot-routines')

const vars = require('../vars')

/**
 * Convert leave object with day, month, year to moment object
 *
 * @param {object} leaveObject - leave object with day, month and year.
 * @returns {moment}
 */
function convertLeaveDatesToMoment (leaveObject) {
  const { day, month, year } = leaveObject
  const dateString = `${day}.${month}.${year}`
  return moment(dateString, vars.CREATION_DATE_FORMAT)
}

/**
 * Generate message with illness info.
 *
 * @param {object} user - user object.
 * @returns {string}
 */
function listIllness (user) {
  if (!user.sick || !user.sick.start) {
    return // If there is no sick info
  }

  const isWork = user.sick.isWork ? ' и работает из дома' : ''
  const formatted = moment(user.sick.start, vars.CREATION_DATE_FORMAT).format(vars.OUTPUT_DATE_FORMAT)

  return `Болеет${isWork} с ${formatted}`
}

/**
 * Generate message with user vacation info.
 *
 * @param {object} user - user object.
 * @returns {string}
 */
function listVacation (user) {
  if (user.vivaLasVegas && user.vivaLasVegas.leaveStart && user.vivaLasVegas.leaveEnd) {
    const today = moment().startOf('day')
    const nextMonth = moment().add(1, 'month')
    const previouseMonth = moment().add(-1, 'month')

    const leaveStart = convertLeaveDatesToMoment(user.vivaLasVegas.leaveStart)
    const leaveEnd = convertLeaveDatesToMoment(user.vivaLasVegas.leaveEnd)

    const leaveStartFormatted = leaveStart.format(vars.OUTPUT_DATE_FORMAT)
    const leaveEndFormatted = leaveEnd.format(vars.OUTPUT_DATE_FORMAT)

    const isCurrently = moment().isBetween(leaveStart, leaveEnd)
    const isSoon = leaveStart.isAfter(today) && leaveStart.isBefore(nextMonth)
    const isRecentlyWas = leaveEnd.isBefore(today) && leaveEnd.isAfter(previouseMonth)

    if (isCurrently) {
      // Vacation is right now
      const messageText = `Сейчас находится в отпуске с ${leaveStartFormatted} до ${leaveEndFormatted}`
      return messageText
    } else if (isSoon) {
      // Vacation is soon and in the next month
      if (user.vivaLasVegas.requestStatus === vars.PENDING_STATUS) {
        // If request is not approved
        const messageText = `Оформлена заявка на отпуск с ${leaveStartFormatted} до ${leaveEndFormatted}`
        return messageText
      } else if (user.vivaLasVegas.requestStatus === vars.APPROVED_STATUS) {
        // If request is approved
        const messageText = `Одобрена заявка на отпуск с ${leaveStartFormatted} до ${leaveEndFormatted}`
        return messageText
      }
    } else if (isRecentlyWas) {
      // Vacation was in previouse month
      const messageText = `Отпуск был с ${leaveStartFormatted} до ${leaveEndFormatted}`
      return messageText
    }
  }
}

/**
 * Generate message with user time-off info.
 *
 * @param {object} user - user object.
 * @returns {string}
 */
function listTimeOff (user) {
  if (!user.timeOff) return

  const nextMonth = moment().add(1, 'month').startOf('day')
  const today = moment().startOf('day')

  const futureDaysOff = user.timeOff.list.filter(item => {
    const dateTimeOff = moment(item.date, vars.CREATION_DATE_FORMAT)

    return dateTimeOff.isBetween(today, nextMonth)
  }).map(item => {
    const dateTimeOff = moment(item.date, vars.CREATION_DATE_FORMAT)
    const dateTimeOffFormatted = dateTimeOff.format(vars.OUTPUT_DATE_FORMAT)

    return `${dateTimeOffFormatted} - ${item.type}`
  })

  if (futureDaysOff.length) {
    return `Берет отгул: ${futureDaysOff.join(', ')}`
  }
}

/**
 * Generate message with user home working info.
 *
 * @param {object} user - user object.
 * @returns {string}
 */
function listWorkFromHome (user) {
  if (!user.vivaLasVegas || !user.vivaLasVegas.dateOfWorkFromHome) return

  const nextMonth = moment().add(1, 'month').startOf('day')

  const futureWorkFromHome = user.vivaLasVegas.dateOfWorkFromHome.filter(item => {
    if (typeof item === 'object') {
      return moment(item.date, vars.CREATION_DATE_FORMAT).isBefore(nextMonth)
    } else if (typeof item === 'string') {
      return moment(item, vars.CREATION_DATE_FORMAT).isBefore(nextMonth)
    }
  }).map(item => {
    if (typeof item === 'object') {
      return moment(item.date, vars.CREATION_DATE_FORMAT).format(vars.OUTPUT_DATE_FORMAT)
    } else if (typeof item === 'string') {
      return moment(item, vars.CREATION_DATE_FORMAT).format(vars.OUTPUT_DATE_FORMAT)
    }
  })

  if (futureWorkFromHome.length) {
    return `Работает из дома: ${futureWorkFromHome.join(', ')}`
  }
}

module.exports = async (msg) => {
  const username = msg.match[1].trim()
  const user = await routines.findUserByName(msg.robot, username)

  const result = []

  // Illness list
  const illResult = listIllness(user)
  if (illResult) {
    result.push(illResult)
  }

  // Vacation list
  const vacationResult = listVacation(user)
  if (vacationResult) {
    result.push(vacationResult)
  }

  // Time-off list
  const timeOffResult = listTimeOff(user)
  if (timeOffResult) {
    result.push(timeOffResult)
  }

  // Work from home list
  const workFromHomeResult = listWorkFromHome(user)
  if (workFromHomeResult) {
    result.push(workFromHomeResult)
  }

  // Result compilation
  if (result.length) {
    const message = `Отчет о пользователе @${username}:\n${result.join(';\n')}.`
    msg.send(message)
  } else {
    msg.send('В ближайшее время нет событий связанных с этим пользователем.')
  }
}
