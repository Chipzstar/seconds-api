const express = require('express');
const { updateJob, updateDelivery } = require('../helpers/stuart');
const { getStuartAuthToken } = require('../helpers');
const router = express.Router();

router.post('/delivery-update', async (req, res) => {
	try {
		//if event is a delivery update
		const { event, type, data } = req.body;
		let jobStatus = null;
		if (event && event === 'job') {
			if (type && type === 'create') {
				console.log('JOB CREATE');
				jobStatus = await updateJob(data);
			}
			if (type && type === 'update') {
				console.log('JOB UPDATE');
				jobStatus = await updateJob(data);
			}
		} else if (event && event === 'delivery') {
			if (type && type === 'create') {
				console.log('DELIVERY CREATE');
				console.log(data);
				jobStatus = await updateDelivery(data);
			}
			if (type && type === 'update') {
				console.log('DELIVERY UPDATE');
				console.log(data);
				jobStatus = await updateDelivery(data);
			}
		}
		return res.status(200).json({
			success: true,
			status: `${type.toUpperCase()}/${event.toUpperCase()}`,
			message: `New job status ${jobStatus}`,
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

