const {clients} = require('../data')

function checkApiKey(apiKey) {
	let isValid = false
	clients.forEach(client => {
		if (client.apiKey === apiKey) {
			console.log("API Key is valid!")
			isValid = true
		}
	})
	return isValid
}

module.exports = {checkApiKey}