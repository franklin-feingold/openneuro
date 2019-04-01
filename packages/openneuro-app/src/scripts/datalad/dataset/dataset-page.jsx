import React from 'react'
import PropTypes from 'prop-types'
import { Redirect } from 'react-router-dom'
import LeftSidebar from './left-sidebar.jsx'
import LeftSidebarButton from './left-sidebar-button.jsx'
import DatasetMain from './dataset-main.jsx'
import DatasetTools from '../fragments/dataset-tools.jsx'
import withProfile from '../../authentication/withProfile.js'

class DatasetPage extends React.Component {
  constructor(props) {
    super(props)
    this.toggleSidebar = this.toggleSidebar.bind(this)
    this.state = {
      sidebar: true,
    }
  }

  toggleSidebar() {
    this.setState({ sidebar: !this.state.sidebar })
  }

  render() {
    if (this.props.profile) {
      return (
        <div className="page dataset">
          <div
            className={
              this.state.sidebar
                ? 'open dataset-container'
                : 'dataset-container'
            }>
            <LeftSidebar
              datasetId={this.props.dataset.id}
              snapshots={this.props.dataset.snapshots}
              draftModified={this.props.dataset.draft.modified}
            />
            <LeftSidebarButton
              sidebar={this.state.sidebar}
              toggle={this.toggleSidebar}
            />
            <DatasetTools dataset={this.props.dataset} />
            <div className="fade-in inner-route dataset-route light">
              <div className="clearfix dataset-wrap">
                <div className="dataset-animation">
                  <div className="col-xs-12 dataset-inner">
                    <DatasetMain dataset={this.props.dataset} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    } else {
      // Redirect to snapshot if not logged in
      const datasetId = this.props.dataset.id
      const tag = this.props.datasets.snapshots[0].tag
      return null
      //return <Redirect to={`/datasets/${datasetId}/versions/${tag}`} />
    }
  }
}

DatasetPage.propTypes = {
  dataset: PropTypes.shape({
    id: PropTypes.string,
    snapshots: PropTypes.array,
  }),
}

export default withProfile(DatasetPage)
