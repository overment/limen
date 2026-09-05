# Outcome

Workers now run the deciding lane at the clean candidate commit, copy reviewer-facing artifacts outside the worktree, and name that retained path. Review handoffs carry the path, while reviewers treat dirty or mismatched evidence as unverified rather than as a candidate defect. Landed `85d57d2` via merge `cf3e9e0`. Independent review passed the candidate after inspecting its retained evidence without rerunning the lane; post-merge structure and template-history checks passed 23 of 23.
