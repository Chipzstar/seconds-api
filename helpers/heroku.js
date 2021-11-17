const Heroku = require('heroku-client');
const heroku = new Heroku({ token: process.env.HEROKU_API_KEY });

async function updateHerokuConfigVar(key, value) {
	try {
		console.log({ key, value });
		// const baseURL = `https://api.heroku.com`;
		const path = `/apps/${process.env.NEW_RELIC_APP_NAME}/config-vars`;
		const payload = { body: {} };
		payload.body[key] = value;
		const config = {
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/vnd.heroku+json; version3'
			}
		};
		return await heroku.patch(path, payload, config);
	} catch (err) {
		console.error(err);
	}
	console.log("Heroku config var updated successfully!")
}

module.exports = { updateHerokuConfigVar };
