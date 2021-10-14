const express = require("express");
const {AUTHORIZATION_KEY} = require("../constants");
const {getClientDetails, getResultantQuotes, chooseBestProvider} = require("../helpers");
const router = express.Router();

/*
 * Get Quotes - The API endpoint for retrieving the bestQuote and the list of quotes from relative providers
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
router.post("/", async (req, res) => {
	try {
		const { selectionStrategy } = await getClientDetails(req.headers[AUTHORIZATION_KEY]);
		console.log("Strategy: ", selectionStrategy)
		const quotes = await getResultantQuotes(req.body);
		const bestQuote = chooseBestProvider(selectionStrategy, quotes);
		return res.status(200).json({
			quotes,
			bestQuote
		})
	} catch (err) {
		console.error("ERROR:", err)
		if (err.message) {
			return res.status(err.code).json({
				error: err
			})
		}
		return res.status(500).json({
			code: 500,
			message: "Unknown error occurred!"
		});
	}
})

module.exports = router;