'use strict';

/**
 * src/jobs/dailyPrayerEmail.js
 *
 * Sends a personalized daily prayer email to every user whose
 * registeredHour matches the current UTC hour AND who hasn't
 * received an email today.
 *
 * Call this from a cron-like interval in src/index.js:
 *   setInterval(runDailyPrayerEmailJob, 60 * 60 * 1000); // every hour
 *   runDailyPrayerEmailJob(); // also run on startup
 */

const prisma = require('../config/prisma');
const { sendDailyPrayerEmail } = require('../services/email');

// Prayers to rotate daily — indexed by day-of-year % array length
const DAILY_PRAYERS = {
  en: [
    { mood: 'grateful',    verse: "Give thanks to the Lord, for he is good; his love endures forever.", ref: "Psalm 107:1",         prayer: "Heavenly Father, today I pause to thank You. For breath, for life, for grace that meets me every morning. You are good, and Your love never fails. Let gratitude fill every corner of my heart today. In Jesus' name, Amen.", action: "Write down 3 things you are grateful for right now." },
    { mood: 'hopeful',     verse: "For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you.", ref: "Jeremiah 29:11", prayer: "Lord, some days the path ahead feels unclear. But Your Word assures me that You have good plans for my life. I choose to hope in You today. Strengthen my faith and help me walk boldly into what You have prepared. Amen.", action: "Take one small step toward a goal you have been delaying." },
    { mood: 'peaceful',    verse: "Be still, and know that I am God.", ref: "Psalm 46:10",        prayer: "Prince of Peace, quiet every storm in my heart today. Silence the anxiety, the rushing thoughts, the noise of life. Let me sit in Your presence and simply know that You are God. I rest in You. In Jesus' name, Amen.", action: "Take 5 minutes of silence today — no phone, no noise. Just breathe with God." },
    { mood: 'faithful',    verse: "The Lord is faithful, and he will strengthen you.", ref: "2 Thessalonians 3:3", prayer: "Lord, You are faithful even when I am not. Thank You for never giving up on me. Help me be faithful today in the small things — in my words, my thoughts, my actions. Make me someone You can trust. Amen.", action: "Do one thing today that requires faithfulness, even when no one is watching." },
    { mood: 'courageous',  verse: "Be strong and courageous. Do not be afraid; do not be discouraged.", ref: "Joshua 1:9",      prayer: "Father, I face things today that feel bigger than me. But You are bigger than all of it. Fill me with holy courage. Let me step forward in faith and not in fear. You go before me. I will not be afraid. In Jesus' name, Amen.", action: "Do one thing today that you have been afraid to do. Trust God with it." },
    { mood: 'healing',     verse: "By his wounds you have been healed.", ref: "1 Peter 2:24",    prayer: "Healing God, I come before You today and declare Your Word: by the stripes of Jesus, I am healed. Touch every area of my mind, my body, and my emotions that needs Your restoration. I receive Your healing now by faith. In Jesus' name, Amen.", action: "Speak aloud three times: 'By the stripes of Jesus, I am healed.'" },
    { mood: 'joyful',      verse: "This is the day the Lord has made; let us rejoice and be glad in it.", ref: "Psalm 118:24",  prayer: "Father, this day is a gift from You. I choose joy today — not because everything is perfect, but because You are with me. Let my joy be a testimony to Your goodness. May it overflow to everyone I meet. To Your glory, Amen.", action: "Encourage one person today with a message, a smile, or a kind word." },
  ],
  fr: [
    { mood: 'grateful',    verse: "Rendez grâces à l'Éternel, car il est bon.", ref: "Psaume 107:1",          prayer: "Père Céleste, aujourd'hui je prends le temps de Te remercier. Pour le souffle, pour la vie, pour la grâce qui me rencontre chaque matin. Tu es bon et Ton amour ne faillit jamais. Que la gratitude remplisse chaque coin de mon cœur aujourd'hui. Au nom de Jésus, Amen.", action: "Écrivez 3 choses pour lesquelles vous êtes reconnaissant en ce moment." },
    { mood: 'hopeful',     verse: "Car je connais les projets que j'ai formés sur vous, projets de paix et non de malheur.", ref: "Jérémie 29:11",   prayer: "Seigneur, parfois le chemin devant moi semble incertain. Mais Ta Parole m'assure que Tu as de bons plans pour ma vie. Je choisis d'espérer en Toi aujourd'hui. Amen.", action: "Faites un petit pas vers un objectif que vous avez retardé." },
    { mood: 'peaceful',    verse: "Arrêtez, et sachez que je suis Dieu.", ref: "Psaume 46:10",        prayer: "Prince de la Paix, apaise chaque tempête dans mon cœur aujourd'hui. Fais taire l'anxiété et le bruit de la vie. Laisse-moi m'asseoir dans Ta présence. Je me repose en Toi. Amen.", action: "Prenez 5 minutes de silence aujourd'hui — pas de téléphone, pas de bruit." },
    { mood: 'faithful',    verse: "Le Seigneur est fidèle; il vous affermira.", ref: "2 Thessaloniciens 3:3", prayer: "Seigneur, Tu es fidèle même quand je ne le suis pas. Merci de ne jamais abandonner. Aide-moi à être fidèle aujourd'hui dans les petites choses. Amen.", action: "Faites quelque chose aujourd'hui qui nécessite de la fidélité." },
    { mood: 'courageous',  verse: "Fortifie-toi et aie du courage. Ne te décourage pas.", ref: "Josué 1:9",        prayer: "Père, je fais face à des choses qui semblent plus grandes que moi. Mais Tu es plus grand que tout cela. Remplis-moi d'un saint courage. Tu vas devant moi. Je n'aurai pas peur. Amen.", action: "Faites une chose aujourd'hui que vous avez eu peur de faire." },
    { mood: 'healing',     verse: "C'est par ses meurtrissures que vous avez été guéris.", ref: "1 Pierre 2:24",    prayer: "Dieu Guérisseur, je viens devant Toi aujourd'hui et déclare Ta Parole: par les meurtrissures de Jésus, je suis guéri. Touche chaque domaine de ma vie qui a besoin de Ta restauration. Amen.", action: "Dites à voix haute trois fois: 'Par les meurtrissures de Jésus, je suis guéri.'" },
    { mood: 'joyful',      verse: "C'est ici la journée que l'Éternel a faite: Qu'elle soit pour nous un sujet d'allégresse.", ref: "Psaume 118:24",  prayer: "Père, ce jour est un cadeau de Ta part. Je choisis la joie aujourd'hui — non pas parce que tout est parfait, mais parce que Tu es avec moi. Que ma joie soit un témoignage de Ta bonté. Amen.", action: "Encouragez une personne aujourd'hui avec un message ou un mot gentil." },
  ],
};

function getPrayerForDay(language) {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const arr = DAILY_PRAYERS[language] || DAILY_PRAYERS.en;
  return arr[dayOfYear % arr.length];
}

async function runDailyPrayerEmailJob() {
  const nowHour = new Date().getUTCHours();
  const today   = new Date().toISOString().split('T')[0];

  console.log(`[DAILY-EMAIL] Job running. UTC hour: ${nowHour}, date: ${today}`);

  try {
    // Find users whose registeredHour matches now AND haven't gotten email today
    const users = await prisma.user.findMany({
      where: {
        isEmailVerified:   true,
        isDisabled:        false,
        dailyEmailEnabled: true,
        registeredHour:    nowHour,
        OR: [
          { lastDailyEmailAt: null },
          { lastDailyEmailAt: { lt: new Date(today + 'T00:00:00.000Z') } },
        ],
      },
      select: { id: true, email: true, fullName: true, language: true },
    });

    if (!users.length) {
      console.log(`[DAILY-EMAIL] No users to email at hour ${nowHour}.`);
      return;
    }

    console.log(`[DAILY-EMAIL] Sending to ${users.length} user(s) at hour ${nowHour}.`);

    for (const user of users) {
      try {
        const prayer = getPrayerForDay(user.language || 'en');
        await sendDailyPrayerEmail(user.email, user.fullName, prayer, user.language || 'en');
        await prisma.user.update({
          where: { id: user.id },
          data:  { lastDailyEmailAt: new Date() },
        });
        console.log(`[DAILY-EMAIL] ✓ Sent to ${user.email}`);
      } catch (err) {
        console.error(`[DAILY-EMAIL] ✗ Failed for ${user.email}:`, err.message);
        // Continue to next user even if one fails
      }
    }
  } catch (err) {
    console.error('[DAILY-EMAIL] Job error:', err.message);
  }
}

module.exports = { runDailyPrayerEmailJob };
