//michelle_d_klein@yahoo.co.uk
//m.soeharjono@gmail.com
// veronicabello@hotmail.it
// andrew@guzzl.club

const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY)

const sendEmail = async options => {
	const msg = {
		from: 'Seconds Technologies <ola@useseconds.com>',
		to: `${options.name} <${options.email}>`,
		subject: options.subject,
		templateId: options.templateId,
		dynamicTemplateData: options.templateData,
	}
	await sgMail.send(msg)
}

module.exports = sendEmail;