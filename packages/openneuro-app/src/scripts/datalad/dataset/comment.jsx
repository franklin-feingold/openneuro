import React, { useState } from 'react'
import PropTypes from 'prop-types'
import userUtil from '../../utils/user.js'
import distanceInWordsToNow from 'date-fns/distance_in_words_to_now'
import { Editor, EditorState, convertFromRaw } from 'draft-js'
import withProfile from '../../authentication/withProfile.js'
import CommentEditor from '../comments/comment-editor.jsx'

const Comment = ({ datasetId, uploader, data, children, profile }) => {
  const [replyMode, setReplyMode] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const parsedText = JSON.parse(data.text)
  const editorState = EditorState.createWithContent(convertFromRaw(parsedText))
  return (
    <>
      <div className="comment">
        <div className="row comment-header">
          {`By ${data.user.email} - ${distanceInWordsToNow(
            data.createDate,
          )} ago`}
        </div>
        <div className="row comment-body">
          <img
            src={userUtil.generateGravatarUrl(data.user)}
            className="comment-avatar"
          />
          {editMode ? (
            <CommentEditor
              datasetId={datasetId}
              commentId={data.id}
              state={editorState}
            />
          ) : (
            <Editor editorState={editorState} />
          )}
        </div>
        <div className="row comment-controls">
          <a className="reply" onClick={() => setReplyMode(!replyMode)}>
            <i className="fa fa-comment" />
            {replyMode ? 'Hide' : 'Reply'}
          </a>
          <a className="edit" onClick={() => setEditMode(!editMode)}>
            <i className="fa fa-edit" />
            {editMode ? 'Hide' : 'Edit'}
          </a>
          {profile.admin && (
            <a className="delete" onClick={() => setReplyMode(false)}>
              <i className="fa fa-trash" />
              Delete
            </a>
          )}
        </div>
      </div>
      <div className="row replies">
        <div className="comment-reply">
          {replyMode ? (
            <CommentEditor datasetId={datasetId} parentId={data.id} />
          ) : null}
        </div>
        {children}
      </div>
    </>
  )
}

export default withProfile(Comment)