// notify.js
//
// Single function every module calls to send an alert:
//   sendAlert({ recipient, channel, message, triggerType })
//
// Right now: records every alert in AlertLog (so nothing is lost,
// and admin can see a full history of what "would have" gone out).
// TODO: once SendGrid is set up, replace the console.log below with
// an actual API call — nothing calling sendAlert() needs to change.

const prisma = require('../db');

async function sendAlert({ recipient, channel, message, triggerType }) {
  if (!recipient) {
    console.warn(`sendAlert skipped — no recipient for triggerType: ${triggerType}`);
    return null;
  }

  // TODO: replace this block with a real SendGrid (or SMS provider) API call
  console.log(`[ALERT - ${channel}] to ${recipient}: ${message}`);

  const log = await prisma.alertLog.create({
    data: { recipient, channel: channel || 'email', message, triggerType },
  });

  return log;
}

module.exports = { sendAlert };
