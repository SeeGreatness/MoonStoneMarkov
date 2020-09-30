"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("source-map-support/register");
const Discord = require("discord.js");
const fs = require("fs");
const markov_strings_1 = require("markov-strings");
const schedule = require("node-schedule");
const version = JSON.parse(fs.readFileSync('./package.json', 'utf8')).version || '0.0.0';
const author = JSON.parse(fs.readFileSync('./package.json', 'utf8')).author || 'GalaxyCat';

const client = new Discord.Client();
const PAGE_SIZE = 100;
let GAME = 'moonstone help';
let PREFIX = 'moonstone';
let STATE_SIZE = 2;
let MAX_TRIES = 10000;
let MIN_SCORE = 1000;
const inviteCmd = 'invite';
const errors = [];
let fileObj = {
    messages: [],
};
let markovDB = [];
let messageCache = [];
let deletionCache = [];
let markovOpts = {
    stateSize: STATE_SIZE,
};
function uniqueBy(arr, propertyName) {
    const unique = [];
    const found = {};
    for (let i = 0; i < arr.length; i += 1) {
        if (arr[i][propertyName]) {
            const value = arr[i][propertyName];
            if (!found[value]) {
                found[value] = true;
                unique.push(arr[i]);
            }
        }
    }
    return unique;
}
function regenMarkov() {
    console.log('Regenerating Markov corpus...');
    try {
        fileObj = JSON.parse(fs.readFileSync('config/markovDB.json', 'utf8'));
        console.log("loaded MarkovDB.json");
    }
    catch (err) {
        console.log('No markovDB.json, starting with initial values');
        fileObj = {
            messages: [
                {
                    id: '0',
                    string: '',
                },
            ],
        };
    }
    markovDB = fileObj.messages;
    markovDB = uniqueBy(markovDB.concat(messageCache), 'id');
    deletionCache.forEach(id => {
        const removeIndex = markovDB.map(item => item.id).indexOf(id);
        markovDB.splice(removeIndex, 1);
    });
    deletionCache = [];
    const markov = new markov_strings_1.default(markovDB, markovOpts);
    fileObj.messages = markovDB;
    fs.writeFileSync('config/markovDB.json', JSON.stringify(fileObj), 'utf-8');
    console.log("wrote to markovDB.json");
    fileObj.messages = [];
    messageCache = [];
    markov.buildCorpus();
    fs.writeFileSync('config/markov.json', JSON.stringify(markov));
    console.log("wrote to markov.json");
    console.log('Done regenerating Markov corpus.');
}
function loadConfig() {
    if (fs.existsSync('./config.json')) {
        console.log('Copying config.json to new location in ./config');
        fs.renameSync('./config.json', './config/config.json');
    }
    if (fs.existsSync('./markovDB.json')) {
        console.log('Copying markovDB.json to new location in ./config');
        fs.renameSync('./markovDB.json', './config/markovDB.json');
    }
    let token = 'missing';
    try {
        const cfg = JSON.parse(fs.readFileSync('./config/config.json', 'utf8'));
        PREFIX = cfg.prefix || '!moonstone';
        GAME = cfg.game || '!moonstone help';
        token = cfg.token || process.env.TOKEN || token;
        STATE_SIZE = cfg.stateSize || STATE_SIZE;
        MIN_SCORE = cfg.minScore || MIN_SCORE;
        MAX_TRIES = cfg.maxTries || MAX_TRIES;
    }
    catch (e) {
        console.warn('Failed to read config.json.');
        token = process.env.TOKEN || token;
    }
    try {
        client.login(token);
    }
    catch (e) {
        console.error('Failed to login with token:', token);
    }
    markovOpts = {
        stateSize: STATE_SIZE,
    };
}
function isModerator(member) {
    return (member.hasPermission('ADMINISTRATOR') ||
        member.hasPermission('MANAGE_CHANNELS') ||
        member.hasPermission('KICK_MEMBERS') ||
        member.hasPermission('MOVE_MEMBERS') ||
        member.id === '360894787785719809');
}
function validateMessage(message) {
    const messageText = message.content.toLowerCase();
    let command = null;
    const thisPrefix = messageText.substring(0, PREFIX.length);
    if (thisPrefix === PREFIX) {
        const split = messageText.split(' ');
        if (split[0] === PREFIX && split.length === 1) {
            command = 'respond';
        }
        else if (split[1] === 'train') {
            command = 'train';
        }
        else if (split[1] === 'help') {
            command = 'help';
        }
        else if (split[1] === 'regen') {
            command = 'regen';
        }
        else if (split[1] === 'invite') {
            command = 'invite';
        }
        else if (split[1] === 'debug') {
            command = 'debug';
        }
        else if (split[1] === 'tts') {
            command = 'tts';
        }
    }
    return command;
}
async function fetchMessages(message) {
    let historyCache = [];
    let keepGoing = true;
    let oldestMessageID;
    while (keepGoing) {
        const messages = await message.channel.fetchMessages({
            before: oldestMessageID,
            limit: PAGE_SIZE,
        });
        const nonBotMessageFormatted = messages
            .filter(elem => !elem.author.bot)
            .map(elem => {
            const dbObj = {
                string: elem.content,
                id: elem.id,
            };
            if (elem.attachments.size > 0) {
                dbObj.attachment = elem.attachments.values().next().value.url;
            }
            return dbObj;
        });
        historyCache = historyCache.concat(nonBotMessageFormatted);
        oldestMessageID = messages.last().id;
        if (messages.size < PAGE_SIZE) {
            keepGoing = false;
        }
    }
    console.log(`Trained from ${historyCache.length} past human authored messages.`);
    messageCache = messageCache.concat(historyCache);
    regenMarkov();
    message.reply(`Finished training from past ${historyCache.length} messages.`);
}
function generateResponse(message, debug = false, tts = message.tts) {
    console.log('Responding...');
    const options = {
        filter: (result) => {
            return result.score >= MIN_SCORE;
        },
        maxTries: MAX_TRIES,
    };
    const fsMarkov = new markov_strings_1.default([''], markovOpts);
    const markovFile = JSON.parse(fs.readFileSync('config/markov.json', 'utf-8'));
    console.log("read markov.json");
    fsMarkov.corpus = markovFile.corpus;
    fsMarkov.startWords = markovFile.startWords;
    fsMarkov.endWords = markovFile.endWords;
    try {
        const myResult = fsMarkov.generate(options);
        console.log('Generated Result:', myResult);
        const messageOpts = { tts };
        const attachmentRefs = myResult.refs
            .filter(ref => Object.prototype.hasOwnProperty.call(ref, 'attachment'))
            .map(ref => ref.attachment);
        if (attachmentRefs.length > 0) {
            const randomRefAttachment = attachmentRefs[Math.floor(Math.random() * attachmentRefs.length)];
            messageOpts.files = [randomRefAttachment];
        }
        else {
            const randomMessage = markovDB[Math.floor(Math.random() * markovDB.length)];
            if (randomMessage.attachment) {
                messageOpts.files = [{ attachment: randomMessage.attachment }];
            }
        }
        myResult.string = myResult.string.replace(/@everyone/g, '@everyοne');
        //.string = myResult.string.replace(/<user>/g, '<@');
        message.channel.send(myResult.string, messageOpts);
        if (debug)
            message.channel.send(`\`\`\`\n${JSON.stringify(myResult, null, 2)}\n\`\`\``);
    }
    catch (err) {
        console.log(err);
        if (debug)
            message.channel.send(`\n\`\`\`\nERROR: ${err}\n\`\`\``);
        if (err.message.includes('Cannot build sentence with current corpus')) {
            console.log('Not enough chat data for a response.');
            message.channel.send("Not enough training to build a sentence!");
        }
    }
}
client.on('ready', () => {
    client.user.setActivity(GAME);
    regenMarkov();
});
client.on('error', err => {
    const errText = `ERROR: ${err.name} - ${err.message}`;
    console.log(errText);
    errors.push(errText);
    fs.writeFile('./config/error.json', JSON.stringify(errors), fsErr => {
        if (fsErr) {
            console.log(`error writing to error file: ${fsErr.message}`);
        }
    });
});
client.on('message', message => {
    if (message.guild) {
        const command = validateMessage(message);
        if (command === 'help') {
            const richem = new Discord.RichEmbed()
                .setAuthor(client.user.username, client.user.avatarURL)
                .setThumbnail(client.user.avatarURL)
                .setDescription('A Markov chain chatbot that speaks based on previous chat input.')
                .addField('!moonstone', 'Generates a sentence to say based on the chat database. Send your ' +
                'message as TTS to recieve it as TTS.')
                .addField('!moonstone train', 'Fetches the maximum amount of previous messages in the current ' +
                'text channel, adds it to the database, and regenerates the corpus. Takes some time.')
                .addField('!moonstone regen', 'Manually regenerates the corpus to add recent chat info. Run ' +
                'this before shutting down to avoid any data loss. This automatically runs at midnight.')
                .addField('!moonstone invite', "Don't invite this bot to other servers. The database is shared " +
                'between all servers and text channels.')
                .addField('!moonstone debug', 'Runs the !mark command and follows it up with debug info.')
                .setFooter(`Markov Discord v${version} by ${author}`);
            message.channel.send(richem).catch(() => {
                message.author.send(richem);
            });
        }
        if (command === 'train') {
            if (isModerator(message.member)) {
                console.log('Training...');
                fileObj = {
                    messages: [],
                };
                fs.writeFileSync('config/markovDB.json', JSON.stringify(fileObj), 'utf-8');
                console.log("wrote to markov.json");
                fetchMessages(message);
            }
        }
        if (command === 'respond') {
            generateResponse(message);
        }
        if (command === 'tts') {
            generateResponse(message, false, true);
        }
        if (command === 'debug') {
            generateResponse(message, true);
        }
        if (command === 'regen') {
            regenMarkov();
        }
        if (command === null) {
            console.log('Listening...');
            if (!message.author.bot) {
                const dbObj = {
                    string: message.content,
                    id: message.id,
                };
                if (message.attachments.size > 0) {
                    dbObj.attachment = message.attachments.values().next().value.url;
                }
                messageCache.push(dbObj);
                if (message.isMentioned(client.user)) {
                    generateResponse(message);
                }
            }
        }
        if (command === inviteCmd) {
            const richem = new Discord.RichEmbed()
                .setAuthor(`Invite ${client.user.username}`, client.user.avatarURL)
                .setThumbnail(client.user.avatarURL)
                .addField('Invite', `[Invite ${client.user.username} to your server](https://discordapp.com/oauth2/authorize?client_id=${client.user.id}&scope=bot&permissions=68608)`);
            message.channel.send(richem).catch(() => {
                message.author.send(richem);
            });
        }
    }
});
client.on('messageDelete', message => {
    deletionCache.push(message.id);
    console.log('deletionCache:', deletionCache);
});
loadConfig();
schedule.scheduleJob('0 4 * * *', () => regenMarkov());

