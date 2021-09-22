const { nanoid } = require('nanoid')
const crypto = require("crypto");
const {SELECTION_STRATEGIES} = require("./constants");

function genApiKey() {
	const rand = crypto.randomBytes(24);
	let chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".repeat(2)

	let str = '';

	for (let i = 0; i < rand.length; i++) {
		let index = rand[i] % chars.length;
		str += chars[index];
	}
	console.log("Generated API Key", str);
	return str;
}
/**
 *  In memory database for current clients.
 *  This is only for testing purposes. A database of clients will be used in production
 * @type {[{apiKey: string, _id: string, email: string}]}
 */
/*const clients = [
	{
		_id: nanoid(10),
		email: "admin@gmail.com",
		apiKey: "admin",
		selectionStrategy: SELECTION_STRATEGIES.ETA
	},
	{
		_id: nanoid(10),
		email: "chisom.oguibe@gmail.com",
		apiKey: genApiKey(),
		selectionStrategy: SELECTION_STRATEGIES.PRICE
	},
	{
		_id: nanoid(10),
		email: "olaoldapo7@gmail.com",
		apiKey: genApiKey(),
		selectionStrategy: SELECTION_STRATEGIES.ETA
	}
]*/

const jobs = []

module.exports = { jobs };