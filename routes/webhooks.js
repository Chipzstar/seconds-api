require('dotenv').config();
const express = require('express');
const router = express.Router();
const db = require('../models');
const moment = require('moment');
const axios = require('axios');
const crypto = require('crypto');
const { URL } = require('url');
const { AUTHORIZATION_KEY } = require('@seconds-technologies/database_schemas/constants');

function stringIsAValidUrl(s, protocols) {
	try {
		const url = new URL(s);
		return protocols
			? url.protocol
				? protocols.map(x => `${x.toLowerCase()}:`).includes(url.protocol)
				: false
			: true;
	} catch (err) {
		return false;
	}
}

function genUniqueId(prefix = '', size = 24) {
	// generate the apiKey using random byte sequences
	const rand = crypto.randomBytes(size);
	let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.repeat(2);
	let secret = prefix ? prefix : '';

	for (let i = 0; i < rand.length; i++) {
		let index = rand[i] % chars.length;
		secret += chars[index];
	}
	console.log('Generated Secret Key', secret);
	return secret;
}

async function validateParams(payload, original) {
	try {
		let error;
		const { topics, endpointURL } = payload;
		// check that the topics and endpointURL are BOTH defined in the payload
		if (topics && endpointURL) {
			// check if any values (topics or endpoint URL) differ from the original webhook
			if (endpointURL !== original.endpointURL) {
				// validate and test the new webhook endpoint URL
				let isValid = stringIsAValidUrl(endpointURL, ['https']);
				// send test message to endpoint to check it is working
				if (isValid) {
					let response = await axios.post(endpointURL, { token: original.secret });
					if (response.status !== 200) {
						error = new Error('Endpoint did not respond with a 200 status code');
						error.status = 400;
						throw error;
					}
				} else {
					error = new Error('Endpoint does not appear to be a valid URL');
					error.status = 400;
					throw error;
				}
				return { topics, endpointURL };
			} else if (topics !== original.topics) {
				return { topics, endpointURL };
			} else {
				error = new Error('Your endpoint URL matches that stored in our records. No change has been made');
				error.status = 304;
				throw error;
			}
		} else {
			error = new Error('Check <endpointURL> and <topics> are defined in your payload');
			error.status = 400;
			throw error;
		}
	} catch (e) {
		console.error(e);
		throw e;
	}
}

async function checkAuthorization(apiKey, webhookClientId) {
	try {
		const user = await db.User.findOne({ apiKey: apiKey });
		return !!(user && webhookClientId === user._id);
	} catch (err) {
		console.error(err);
		throw err;
	}
}

/**
 * Endpoint for creating a new webhook
 *
 */
router.post('/', async (req, res) => {
	try {
		const { email, topics, endpointURL } = req.body;
		const user = await db.User.findOne({ email });
		if (user) {
			const webhookId = genUniqueId('we_', 16);
			const secret = genUniqueId('whsec_');
			// validate the endpoint URL is a valid format with https protocol
			let isValid = stringIsAValidUrl(endpointURL, ['https']);
			// send test message to endpoint to check it is working
			if (isValid) {
				let response = await axios.post(endpointURL, { token: secret });
				if (response.status === 200) {
					let lastUsed = moment().toISOString(true);
					// store the webhook details as a new recorded in the database
					const result = {
						id: webhookId,
						clientId: user._id,
						topics,
						endpointURL,
						lastUsed,
						apiVersion: process.env.CURRENT_API_VERSION,
						secret
					};
					const webhook = await db.Webhook.create(result);
					res.status(200).json({
						success: true,
						message: 'Webhook created successfully',
						webhook
					});
				} else {
					const error = new Error(`Endpoint URL did not respond with 200 status code`);
					error.status = 400;
					throw error;
				}
			} else {
				const error = new Error(`Please enter a valid endpoint URL prefixed with "https://"`);
				error.status = 400;
				throw error;
			}
		} else {
			const error = new Error(`No user found with email address ${email}`);
			error.status = 404;
			throw error;
		}
	} catch (err) {
		console.error(err);
		err.response && err.response.status
			? res.status(err.response.status).json({
					code: err.response.status,
					success: false,
					message: err.message
			  })
			: res.status(500).json({
					success: false,
					code: 500,
					message: err.message
			  });
	}
});

/**
 * List all webhooks for a given user
 * @query {email} - email of the account to search from
 */
router.get('/', async (req, res) => {
	try {
		const { email } = req.query;
		const user = await db.User.findOne({ email: email });
		if (user) {
			let webhooks = await db.Webhook.find({ clientId: user._id });
			return res.status(200).json(webhooks);
		} else {
			let error = new Error(`No user found with email ${email}`);
			error.status = 404;
			throw error;
		}
	} catch (err) {
		console.error(err);
		err && err.status
			? res.status(err.status).json({
					code: err.status,
					success: false,
					message: err.message
			  })
			: res.status(500).json({
					success: false,
					code: 500,
					message: err.message
			  });
	}
});

/**
 * Retrieve a specific webhook
 * @param {id} - the is of the webhook
 */
router.get('/:id', async (req, res) => {
	try {
		const id = req.params.id;
		const webhook = await db.Webhook.findOne({ id });
		if (webhook) return res.status(200).json(webhook);
		let error = new Error(`No webhook found with ID ${id}`);
		error.status = 404;
		throw error;
	} catch (err) {
		console.error(err);
		err && err.status
			? res.status(err.status).json({
					code: err.status,
					success: false,
					message: err.message
			  })
			: res.status(500).json({
					success: false,
					code: 500,
					message: err.message
			  });
	}
});

/**
 * Update a specific webhook
 * @param {id} - the is of the webhook
 */
router.patch('/:id', async (req, res) => {
	try {
		const id = req.params.id;
		const webhook = await db.Webhook.findOne({ id });
		if (webhook) {
			// check request is authorized to update this webhook
			const isAuthorized = await checkAuthorization(req.headers[AUTHORIZATION_KEY], webhook.clientId);
			const params = await validateParams(req.body, webhook);
			if (isAuthorized) {
				webhook.update(params);
				await webhook.save();
				return res.status(200).json(webhook);
			} else {
				let error = new Error('You cannot update this webhook as it belongs to another user');
				error.status = 403;
				throw error;
			}
		} else {
			let error = new Error(`No webhook found with ID ${id}`);
			error.status = 404;
			throw error;
		}
	} catch (err) {
		console.error(err);
		err && err.status
			? res.status(err.status).json({
					code: err.status,
					success: false,
					message: err.message
			  })
			: res.status(500).json({
					success: false,
					code: 500,
					message: err.message
			  });
	}
});

/**
 * Delete a specific webhook
 * @param {id} - the is of the webhook
 */
router.delete('/:id', async (req, res) => {
	try {
		const id = req.params.id;
		const webhook = await db.Webhook.findOneAndDelete({ id: id}, {returnOriginal: true});
		if (webhook) {
			console.log(webhook)
			res.status(200).json({
				status: 'deleted',
				webhookId: id,
				message: 'webhook deleted successfully'
			});
		} else {
			let error = new Error(`No webhook found with ID ${id}`);
			error.status = 404;
			throw error;
		}
	} catch (err) {
		console.error(err);
		err && err.status
			? res.status(err.status).json({
					code: err.status,
					success: false,
					message: err.message
			  })
			: res.status(500).json({
					success: false,
					code: 500,
					message: err.message
			  });
	}
});

module.exports = router;
