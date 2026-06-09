from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import CorpusCollectionViewSet, CoResearcherAskView, ResearchQueryViewSet


router = DefaultRouter()
router.register(r'corpus-collections', CorpusCollectionViewSet, basename='corpus-collection')
router.register(r'research-queries', ResearchQueryViewSet, basename='research-query')

urlpatterns = [
    path('co-researcher/ask/', CoResearcherAskView.as_view(), name='coresearcher-ask'),
] + router.urls
