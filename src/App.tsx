import { useRoute } from './ui/router';
import { PhotoMeasureHost } from './ui/PhotoMeasureHost';
import {
  CalibrationListScreen,
  CalibrationSessionScreen,
} from './ui/screens/CalibrationScreen';
import { CaptureScreen } from './ui/screens/CaptureScreen';
import { InspectionScreen } from './ui/screens/InspectionScreen';
import { PlanScreen } from './ui/screens/PlanScreen';
import { ProjectScreen } from './ui/screens/ProjectScreen';
import { ProjectsScreen } from './ui/screens/ProjectsScreen';
import { ReportScreen } from './ui/screens/ReportScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';

export function App() {
  const route = useRoute();

  return (
    <div className="app">
      {renderRoute(route)}
      {/*
        Mounted once at the root so the desktop measurement provider always has
        a host to call, whichever screen initiates the capture.
      */}
      <PhotoMeasureHost />
    </div>
  );
}

function renderRoute(route: ReturnType<typeof useRoute>) {
  switch (route.name) {
    case 'projects':
      return <ProjectsScreen />;
    case 'project':
      return <ProjectScreen projectId={route.projectId} />;
    case 'plan':
      return <PlanScreen projectId={route.projectId} sheetId={route.sheetId} />;
    case 'inspection':
      return <InspectionScreen projectId={route.projectId} inspectionId={route.inspectionId} />;
    case 'capture':
      return (
        <CaptureScreen
          projectId={route.projectId}
          inspectionId={route.inspectionId}
          kind={route.kind}
        />
      );
    case 'report':
      return <ReportScreen projectId={route.projectId} inspectionId={route.inspectionId} />;
    case 'settings':
      return <SettingsScreen />;
    case 'calibration':
      return <CalibrationListScreen />;
    case 'calibration-session':
      return <CalibrationSessionScreen sessionId={route.sessionId} />;
  }
}
