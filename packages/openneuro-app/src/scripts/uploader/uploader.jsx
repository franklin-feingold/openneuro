import React from 'react'
import { ApolloConsumer } from 'react-apollo'
import UploaderContext from './uploader-context.js'
import UploaderSetupRoutes from './uploader-setup-routes.jsx'
import UploaderStatusRoutes from './uploader-status-routes.jsx'
import UploadButton from './upload-button.jsx'
import UploadProgressButton from './upload-progress-button.jsx'
import { locationFactory } from './uploader-location.js'
import * as mutation from './upload-mutation.js'

/**
 * Stateful uploader workflow and status
 *
 * Usable from anywhere, so this button sets up a modal and
 * virtual router to navigate within it.
 */
class UploadClient extends React.Component {
  constructor(props) {
    super(props)

    this.start = this.start.bind(this)
    this.setLocation = this.setLocation.bind(this)
    this.setName = this.setName.bind(this)
    this.selectFiles = this.selectFiles.bind(this)
    this.validate = this.validate.bind(this)
    this.disclaimer = this.disclaimer.bind(this)
    this.upload = this.upload.bind(this)

    this.state = {
      uploading: false, // An upload is processing
      location: locationFactory('/hidden'), // Which step in the modal
      files: [], // List of files being uploaded
      name: '', // Relabel dataset during upload
      resume: null, // Resume an existing dataset
      setLocation: this.setLocation, // Allow context consumers to change routes
      setName: this.setName, // Rename on upload (optionally)
      selectFiles: this.selectFiles, // Get files from the browser
      validate: this.validate, // Continue to validate step
      disclaimer: this.disclaimer, // Continue to disclaimer
      upload: this.upload, // Start an upload
    }
  }

  /**
   * Initiate the upload workflow
   */
  start() {
    this.setState({ location: locationFactory('/upload') })
  }

  setLocation(path) {
    this.setState({ location: locationFactory(path) })
  }

  setName(name) {
    this.setState({ name })
  }

  /**
   * Select the files for upload
   * @param {object} event onChange event from multi file select
   */
  selectFiles({ files }) {
    if (files.length > 0) {
      this.setState({
        files,
        location: locationFactory('/upload/rename'),
        name: files[0].webkitRelativePath.split('/')[0],
      })
    } else {
      throw new Error('No files selected')
    }
  }

  validate() {
    this.setState({ location: locationFactory('/upload/issues') })
  }

  disclaimer() {
    this.setState({ location: locationFactory('/upload/disclaimer') })
  }

  upload() {
    this.setState({ uploading: true, location: locationFactory('/hidden') })
    const client = this.props.client
    if (this.state.resume) {
      // Diff and add files
    } else {
      // Create dataset and then add files
      mutation
        .createDataset(client)(this.state.name)
        .then(datasetId =>
          mutation.updateFiles(client)(datasetId, this.state.files),
        )
        .catch(err => {
          this.setState({ uploading: false })
          throw err
        })
    }
  }

  render() {
    if (this.state.uploading) {
      return (
        <UploaderContext.Provider value={this.state}>
          <UploadProgressButton />
          <UploaderStatusRoutes location={this.state.location} />
        </UploaderContext.Provider>
      )
    } else {
      return (
        <UploaderContext.Provider value={this.state}>
          <UploadButton onClick={this.start} />
          <UploaderSetupRoutes location={this.state.location} />
        </UploaderContext.Provider>
      )
    }
  }
}

const Uploader = () => (
  <ApolloConsumer>
    {client => (
      <div className="uploader">
        <UploadClient client={client} />
      </div>
    )}
  </ApolloConsumer>
)

export default Uploader
