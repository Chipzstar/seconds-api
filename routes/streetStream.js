require("dotenv").config();
const express = require("express");
const router = express.Router();

router.post("/", async (req, res) => {
	try {
		console.log(req.body)
	    res.status(200).send({
		    ...req.body
	    })
	} catch (err) {
	    console.error(err)
		res.status(500).json({
			error: { ...err}
		})
	}
})

module.exports = router;