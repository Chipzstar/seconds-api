const express = require('express');
const { updateJob, updateDelivery, updateDriverETA } = require('../helpers/stuart');
const { getStuartAuthToken } = require('../helpers');
const router = express.Router();

router.post('/delivery-update', async (req, res) => {
	try {
		//if event is a delivery update
		const { event, type, data } = req.body;
		let message;
		let jobStatus = null;
		if (event && event === 'job') {
			if (type && type === 'create') {
				console.log('JOB CREATE');
				jobStatus = await updateJob(data);
				message = `New job status ${jobStatus}`
			}
			if (type && type === 'update') {
				console.log('JOB UPDATE');
				jobStatus = await updateJob(data);
				message = `New job status ${jobStatus}`
			}
		} else if (event && event === 'delivery') {
			if (type && type === 'create') {
				console.log('DELIVERY CREATE');
				console.log(data);
				jobStatus = await updateDelivery(data);
				message = `New job status ${jobStatus}`
			}
			if (type && type === 'update') {
				console.log('DELIVERY UPDATE');
				console.log(data);
				jobStatus = await updateDelivery(data);
				message = `New job status ${jobStatus}`
			}
		} else if (event && event === 'driver'){
			if (type && type === 'update'){
				console.log('DRIVER UPDATE')
				let jobETA = await updateDriverETA(data)
				message = `New job eta: ${jobETA}`
			}
		}
		return res.status(200).json({
			success: true,
			status: `${type.toUpperCase()}/${event.toUpperCase()}`,
			message,
		});
	} catch (err) {
		console.error(err);
		return res.status(200).json({
			success: false,
			status: 'EVENT_UNRECOGNISED',
			message: err.message,
		});
	}
});

router.get('/auth', async (req, res) => {
	try {
		const token = await getStuartAuthToken();
		return res.status(200).json({
			token,
			status: 'success',
		});
	} catch (err) {
		console.error(err);
		res.status(400).json(err.response)
	}
});

module.exports = router;

