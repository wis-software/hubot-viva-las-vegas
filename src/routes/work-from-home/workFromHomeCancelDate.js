const vars = require('../../vars')
const utils = require('../../utils')

module.exports = async (msg) => {
  const state = await utils.getStateFromBrain(msg.robot, msg.message.user.name)
  const date = msg.match[2]

  state.dateOfWorkFromHome = state.dateOfWorkFromHome || []

  const event = state.dateOfWorkFromHome.find(item => {
    if (typeof item === 'string') {
      return item === date
    } else {
      return item.date === date
    }
  })

  if (!event) {
    return msg.send(`У тебя не запланирован день работы из дома на ${date}`)
  }

  if (vars.GOOGLE_API && event.eventId) {
    utils.deleteEventFromCalendar(msg.robot, event.eventId)
    msg.send('Я тебя понял. :ok_hand: Убираю событие из календаря.')
  } else {
    msg.send('Я тебя понял. :ok_hand:')
  }

  state.dateOfWorkFromHome = state.dateOfWorkFromHome.filter(item => {
    if (typeof item === 'string') {
      return item !== date
    } else {
      return item.date !== date
    }
  })
}
