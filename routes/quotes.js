const express = require('express');
const { AUTHORIZATION_KEY } = require('../constants');
const {
	getClientDetails,
	getResultantQuotes,
	chooseBestProvider,
	getVehicleSpecs,
	calculateJobDistance,
	checkAlternativeVehicles,
} = require('../helpers');
const moment = require('moment');
const router = express.Router();

/*
 * Get Quotes - The API endpoint for retrieving the bestQuote and the list of quotes from relative providers
 * @constructor
 * @param req - request object
 * @param res - response object
 * @returns {Promise<*>}
 */
router.post('/', async (req, res) => {
	try {
		console.table(req.body)
		console.table(req.body.drops[0])
		const user = await getClientDetails(req.headers[AUTHORIZATION_KEY]);
		console.log('Strategy: ', user.selectionStrategy);
		// check that the vehicleType is valid and return the vehicle's specifications
		let vehicleSpecs = getVehicleSpecs(req.body.vehicleType);
		console.log(vehicleSpecs);
		// calculate job distance
		const jobDistance = await calculateJobDistance(
			req.body.pickupAddress,
			req.body.drops[0].dropoffAddress,
			vehicleSpecs.travelMode
		);
		// check if distance is less than or equal to the vehicle's max pickup to dropoff distance
		if (jobDistance > vehicleSpecs.maxDistance)
			vehicleSpecs = await checkAlternativeVehicles(
				req.body.pickupAddress,
				req.body.drops[0].dropoffAddress,
				jobDistance,
				vehicleSpecs.travelMode
			);
		const quotes = await getResultantQuotes(req.body, vehicleSpecs);
		const bestQuote = chooseBestProvider(user.selectionStrategy, quotes);
		return res.status(200).json({
			quotes,
			bestQuote,
		});
	} catch (err) {
		console.error('ERROR:', err);
		if (err.message) {
			return res.status(err.code).json({
				error: err,
			});
		}
		return res.status(500).json({
			code: 500,
			message: 'Unknown error occurred!',
		});
	}
});

module.exports = router;